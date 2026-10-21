/* BakyHub: frontend público. Las reglas de seguridad reales deben estar en Supabase RLS. */
const SUPABASE_URL = "https://imaslowgszmefgabjbvl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__A9yM6nUmtCeTeWT-atEXg_neodznEG";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const VIEWS = ["feedView", "friendsView", "requestsView", "chatView", "profileView"];
let currentUser = null;
let currentProfile = null;
let authMode = "login";
let selectedMedia = null;
let toastTimer = null;
let activeConversationId = null;
let activeConversationIsGroup = false;
let chatRealtimeChannel = null;
let chatRefreshTimer = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function fallbackAvatar(seed = "BakyHub") {
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
}
function avatarUrl(profile) {
  return profile?.avatar_url || fallbackAvatar(profile?.display_name || profile?.username || "BakyHub");
}
function setMessage(id, message = "", type = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = `form-message ${type}`.trim();
}
function notify(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function setBusy(button, busy, busyText = "Procesando...") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}
function normalizeUsername(value) {
  return value.trim().replace(/^@/, "").toLowerCase();
}
function validUsername(value) {
  return /^[a-z0-9_]{3,24}$/.test(value);
}
function showView(viewId) {
  if (!currentUser) {
    $("authPanel").classList.remove("hidden");
    VIEWS.forEach((id) => $(id)?.classList.add("hidden"));
    return;
  }
  $("authPanel").classList.add("hidden");
  VIEWS.forEach((id) => $(id)?.classList.toggle("hidden", id !== viewId));
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
  if (viewId === "feedView") loadPosts();
  if (viewId === "friendsView") loadFriends();
  if (viewId === "requestsView") loadRequests();
  if (viewId === "chatView") loadChatHome();
  if (viewId === "profileView") fillProfileForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.showView = showView;

function switchAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  $("loginTab").classList.toggle("active", !registering);
  $("registerTab").classList.toggle("active", registering);
  $("usernameField").classList.toggle("hidden", !registering);
  $("authTitle").textContent = registering ? "Crea tu cuenta" : "Qué bueno verte";
  $("authSubtitle").textContent = registering
    ? "Elige un username único para que te encuentren."
    : "Entra a tu cuenta para continuar.";
  $("authSubmit").innerHTML = registering ? 'Crear cuenta <span>→</span>' : 'Iniciar sesión <span>→</span>';
  $("authPassword").autocomplete = registering ? "new-password" : "current-password";
  setMessage("authMessage", "");
}
$("loginTab").addEventListener("click", () => switchAuthMode("login"));
$("registerTab").addEventListener("click", () => switchAuthMode("register"));

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const username = normalizeUsername($("authUsername").value);
  const button = $("authSubmit");
  setMessage("authMessage", "");
  if (authMode === "register") {
    if (!validUsername(username)) {
      setMessage("authMessage", "El username debe tener 3–24 caracteres: letras, números o guion bajo.", "error");
      return;
    }
    setBusy(button, true, "Creando cuenta...");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: username },
        emailRedirectTo: "https://devenginer976.github.io/Baky-Hub/"
      }
    });
    setBusy(button, false);
    if (error) {
      setMessage("authMessage", readableError(error), "error");
      return;
    }
    if (data.session) {
      await initializeApp(data.session.user);
      notify("¡Cuenta creada! Bienvenido a BakyHub.");
    } else {
      setMessage("authMessage", "Cuenta creada. Revisa tu correo y abre el enlace de confirmación más reciente. Después inicia sesión.", "success");
    }
  } else {
    setBusy(button, true, "Entrando...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(button, false);
    if (error) {
      setMessage("authMessage", readableError(error), "error");
      return;
    }
    await initializeApp(data.user);
    notify("¡Has iniciado sesión!");
  }
});

function readableError(error) {
  const msg = String(error?.message || "Ocurrió un error.");
  if (/Invalid login credentials/i.test(msg)) return "Correo o contraseña incorrectos.";
  if (/User already registered/i.test(msg)) return "Ese correo ya tiene una cuenta. Inicia sesión.";
  if (/username/i.test(msg) && /duplicate|unique/i.test(msg)) return "Ese username ya está ocupado. Prueba otro.";
  if (/email not confirmed/i.test(msg)) return "Confirma tu correo desde el enlace más reciente que recibiste.";
  if (/Failed to fetch/i.test(msg)) return "No se pudo conectar con Supabase. Revisa tu conexión y la configuración del proyecto.";
  return msg;
}

async function ensureProfile(user) {
  let { data: profile, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (profile) return profile;
  const meta = user.user_metadata || {};
  const base = normalizeUsername(meta.username || user.email?.split("@")[0] || `user_${user.id.slice(0, 8)}`);
  const username = validUsername(base) ? base : `user_${user.id.slice(0, 8)}`;
  const { data, error: insertError } = await supabase.from("profiles").insert({
    id: user.id,
    username,
    display_name: meta.display_name || username,
    bio: "",
    status: ""
  }).select("*").single();
  if (insertError) throw insertError;
  return data;
}

async function initializeApp(user) {
  currentUser = user;
  try {
    currentProfile = await ensureProfile(user);
    updateUserChrome();
    $("authPanel").classList.add("hidden");
    $("logoutButton").classList.remove("hidden");
    await Promise.all([loadCounts(), loadPosts()]);
    showView("feedView");
  } catch (error) {
    console.error(error);
    setMessage("authMessage", `Iniciaste sesión, pero no se pudo cargar tu perfil: ${readableError(error)}. Comprueba que ejecutaste el SQL de BakyHub.`, "error");
    $("authPanel").classList.remove("hidden");
  }
}

function updateUserChrome() {
  const profile = currentProfile || {};
  const name = profile.display_name || profile.username || currentUser?.email || "Usuario";
  $("topUser").textContent = `@${profile.username || ""}`;
  $("sidebarName").textContent = name;
  $("sidebarStatus").textContent = profile.status || "Sin estado";
  $("sidebarAvatar").src = avatarUrl(profile);
  $("composerAvatar").src = avatarUrl(profile);
}
async function logoutUser() {
  if (chatRealtimeChannel) { await supabase.removeChannel(chatRealtimeChannel); chatRealtimeChannel = null; }
  activeConversationId = null;
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  $("logoutButton").classList.add("hidden");
  $("topUser").textContent = "Sin sesión";
  $("sidebarName").textContent = "Invitado";
  $("sidebarStatus").textContent = "Conéctate para empezar";
  $("sidebarAvatar").src = fallbackAvatar();
  $("postsList").innerHTML = "";
  showView("feedView");
  notify("Has cerrado sesión.");
}
window.logoutUser = logoutUser;

async function loadCounts() {
  if (!currentUser) return;
  const [{ count: friendsCount }, { count: incomingCount }] = await Promise.all([
    supabase.from("friendships").select("*", { count: "exact", head: true })
      .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`),
    supabase.from("friend_requests").select("*", { count: "exact", head: true })
      .eq("receiver_id", currentUser.id).eq("status", "pending")
  ]);
  $("friendCount").textContent = friendsCount || 0;
  $("requestCount").textContent = incomingCount || 0;
}

async function loadPosts() {
  if (!currentUser) return;
  const { data: posts, error } = await supabase.from("posts")
    .select("id,user_id,content,media_url,media_type,created_at,profiles(id,username,display_name,avatar_url,status)")
    .order("created_at", { ascending: false }).limit(60);
  if (error) {
    $("postsList").innerHTML = `<div class="empty-state panel"><h3>No se pudieron cargar las publicaciones</h3><p>${escapeHtml(readableError(error))}</p></div>`;
    return;
  }
  renderPosts(posts || []);
}
function renderPosts(posts) {
  const query = $("searchInput").value.trim().toLowerCase();
  const filtered = posts.filter((post) => {
    const text = `${post.content || ""} ${post.profiles?.username || ""} ${post.profiles?.display_name || ""}`.toLowerCase();
    return text.includes(query);
  });
  if (!filtered.length) {
    $("postsList").innerHTML = `<div class="empty-state panel"><div class="empty-icon">✦</div><h3>${query ? "No hay resultados" : "Todavía no hay publicaciones"}</h3><p>${query ? "Prueba con otra búsqueda." : "Sé la primera persona en compartir algo con la comunidad."}</p></div>`;
    return;
  }
  $("postsList").innerHTML = filtered.map((post) => {
    const profile = post.profiles || {};
    const name = escapeHtml(profile.display_name || profile.username || "Usuario");
    const username = escapeHtml(profile.username || "usuario");
    const content = escapeHtml(post.content || "");
    const date = new Date(post.created_at).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
    let media = "";
    if (post.media_url) {
      media = post.media_type === "video"
        ? `<video class="post-media" controls preload="metadata" src="${escapeHtml(post.media_url)}"></video>`
        : `<img class="post-media" loading="lazy" src="${escapeHtml(post.media_url)}" alt="Imagen de la publicación">`;
    }
    return `<article class="post-card panel">
      <div class="post-header"><img class="avatar" src="${escapeHtml(avatarUrl(profile))}" alt=""><div class="post-author"><strong>${name}</strong><small>@${username} · ${escapeHtml(date)}</small></div></div>
      ${content ? `<p class="post-text">${content}</p>` : ""}
      ${media}
      <div class="post-actions"><span>${escapeHtml(profile.status || "Compartiendo en BakyHub")}</span>${post.user_id === currentUser.id ? `<button class="delete-post" data-delete-post="${post.id}">Eliminar publicación</button>` : ""}</div>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-delete-post]").forEach((button) => button.addEventListener("click", () => deletePost(button.dataset.deletePost)));
}
$("searchInput").addEventListener("input", () => loadPosts());
$("refreshButton").addEventListener("click", () => loadPosts());

$("postMedia").addEventListener("change", () => {
  selectedMedia = $("postMedia").files?.[0] || null;
  $("mediaPreview").innerHTML = "";
  $("mediaPreview").classList.toggle("hidden", !selectedMedia);
  $("fileName").textContent = selectedMedia ? selectedMedia.name : "Comparte un momento con la comunidad";
  if (!selectedMedia) return;
  const url = URL.createObjectURL(selectedMedia);
  const element = selectedMedia.type.startsWith("video/") ? document.createElement("video") : document.createElement("img");
  element.src = url;
  if (element.tagName === "VIDEO") element.controls = true;
  $("mediaPreview").appendChild(element);
});
$("postForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const content = $("postText").value.trim();
  if (!content && !selectedMedia) {
    setMessage("postMessage", "Escribe algo o elige una foto/vídeo.", "error");
    return;
  }
  if (selectedMedia && selectedMedia.size > 50 * 1024 * 1024) {
    setMessage("postMessage", "El archivo supera el límite de 50 MB.", "error");
    return;
  }
  const button = $("publishButton");
  setBusy(button, true, "Publicando...");
  setMessage("postMessage", "");
  try {
    let mediaUrl = null;
    let mediaType = null;
    if (selectedMedia) {
      const safeName = selectedMedia.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${currentUser.id}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage.from("post-media").upload(path, selectedMedia, { upsert: false, contentType: selectedMedia.type });
      if (uploadError) throw uploadError;
      const { data: publicData } = supabase.storage.from("post-media").getPublicUrl(path);
      mediaUrl = publicData.publicUrl;
      mediaType = selectedMedia.type.startsWith("video/") ? "video" : "image";
    }
    const { error } = await supabase.from("posts").insert({ user_id: currentUser.id, content, media_url: mediaUrl, media_type: mediaType });
    if (error) throw error;
    $("postText").value = "";
    $("postMedia").value = "";
    $("mediaPreview").innerHTML = "";
    $("mediaPreview").classList.add("hidden");
    $("fileName").textContent = "Comparte un momento con la comunidad";
    selectedMedia = null;
    await loadPosts();
    notify("¡Publicación compartida!");
  } catch (error) {
    setMessage("postMessage", readableError(error), "error");
  } finally {
    setBusy(button, false);
  }
});
async function deletePost(id) {
  if (!confirm("¿Seguro que quieres eliminar esta publicación?")) return;
  const { error } = await supabase.from("posts").delete().eq("id", id).eq("user_id", currentUser.id);
  if (error) return notify(readableError(error));
  notify("Publicación eliminada.");
  loadPosts();
}

async function fillProfileForm() {
  if (!currentUser || !currentProfile) return;
  $("profileAvatarPreview").src = avatarUrl(currentProfile);
  $("profileDisplayName").textContent = currentProfile.display_name || currentProfile.username;
  $("profileHandle").textContent = `@${currentProfile.username}`;
  $("profileDisplayInput").value = currentProfile.display_name || "";
  $("profileBio").value = currentProfile.bio || "";
  $("profileStatus").value = currentProfile.status || "";
  renderProfilePreview();
}
function renderProfilePreview() {
  const name = $("profileDisplayInput").value.trim() || currentProfile?.username || "Tu nombre";
  const status = $("profileStatus").value.trim() || "Sin estado";
  $("profileDisplayName").textContent = name;
  $("profileHandle").textContent = `@${currentProfile?.username || "username"}`;
  $("previewName").textContent = name;
  $("previewHandle").textContent = `@${currentProfile?.username || "username"}`;
  $("previewStatus").textContent = status;
  $("previewBio").textContent = $("profileBio").value.trim() || "Tu descripción aparecerá aquí.";
  $("previewAvatar").src = $("profileAvatarPreview").src;
}
["profileDisplayInput", "profileBio", "profileStatus"].forEach((id) => $(id).addEventListener("input", renderProfilePreview));
$("profileAvatar").addEventListener("change", () => {
  const file = $("profileAvatar").files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { setMessage("profileMessage", "Elige un archivo de imagen.", "error"); return; }
  if (file.size > 5 * 1024 * 1024) { setMessage("profileMessage", "La foto debe pesar menos de 5 MB.", "error"); return; }
  $("profileAvatarPreview").src = URL.createObjectURL(file);
  renderProfilePreview();
});
$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser || !currentProfile) return;
  const button = $("saveProfileButton");
  setBusy(button, true, "Guardando...");
  setMessage("profileMessage", "");
  try {
    let avatar_url = currentProfile.avatar_url || null;
    const file = $("profileAvatar").files?.[0];
    if (file) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${currentUser.id}/avatar_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("profile-avatars").upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      avatar_url = supabase.storage.from("profile-avatars").getPublicUrl(path).data.publicUrl;
    }
    const updates = {
      display_name: $("profileDisplayInput").value.trim().slice(0, 40) || currentProfile.username,
      bio: $("profileBio").value.trim().slice(0, 240),
      status: $("profileStatus").value.trim().slice(0, 80),
      avatar_url,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("profiles").update(updates).eq("id", currentUser.id).select("*").single();
    if (error) throw error;
    currentProfile = data;
    updateUserChrome();
    fillProfileForm();
    setMessage("profileMessage", "Perfil actualizado correctamente.", "success");
    notify("¡Perfil guardado!");
  } catch (error) {
    setMessage("profileMessage", readableError(error), "error");
  } finally {
    setBusy(button, false);
  }
});

$("friendSearchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const username = normalizeUsername($("friendUsername").value);
  setMessage("friendSearchMessage", "");
  if (!validUsername(username)) {
    setMessage("friendSearchMessage", "Escribe un username válido (3–24 letras, números o guion bajo).", "error");
    return;
  }
  if (username === currentProfile.username.toLowerCase()) {
    setMessage("friendSearchMessage", "No puedes enviarte una solicitud a ti mismo.", "error");
    return;
  }
  const button = event.submitter || $("friendSearchForm").querySelector("button");
  setBusy(button, true, "Buscando...");
  try {
    const { data: person, error: searchError } = await supabase.from("profiles").select("id,username,display_name").eq("username", username).maybeSingle();
    if (searchError) throw searchError;
    if (!person) throw new Error("No encontramos ese username. Revisa que esté escrito correctamente.");
    const { data: existingFriend } = await supabase.from("friendships").select("id").or(
      `and(user_id.eq.${currentUser.id},friend_id.eq.${person.id}),and(user_id.eq.${person.id},friend_id.eq.${currentUser.id})`
    ).maybeSingle();
    if (existingFriend) throw new Error("Ya son amigos.");
    const { data: existingRequest, error: reqError } = await supabase.from("friend_requests").select("id,sender_id,receiver_id,status")
      .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${person.id}),and(sender_id.eq.${person.id},receiver_id.eq.${currentUser.id})`)
      .eq("status", "pending").maybeSingle();
    if (reqError) throw reqError;
    if (existingRequest) {
      if (existingRequest.sender_id === person.id) {
        throw new Error("Esta persona ya te envió una solicitud. Ve a Solicitudes para aceptarla.");
      }
      throw new Error("Ya enviaste una solicitud a esta persona.");
    }
    const { error: insertError } = await supabase.from("friend_requests").insert({
      sender_id: currentUser.id, receiver_id: person.id, status: "pending"
    });
    if (insertError) throw insertError;
    $("friendUsername").value = "";
    setMessage("friendSearchMessage", `Solicitud enviada a @${person.username}.`, "success");
    notify("Solicitud de amistad enviada.");
    loadRequests();
    loadCounts();
  } catch (error) {
    setMessage("friendSearchMessage", readableError(error), "error");
  } finally {
    setBusy(button, false);
  }
});

async function loadFriends() {
  if (!currentUser) return;
  const { data: links, error } = await supabase.from("friendships").select("id,user_id,friend_id,created_at")
    .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`).order("created_at", { ascending: false });
  if (error) {
    $("friendsList").innerHTML = `<div class="person-empty">No se pudieron cargar los amigos: ${escapeHtml(readableError(error))}</div>`;
    return;
  }
  const ids = (links || []).map((link) => link.user_id === currentUser.id ? link.friend_id : link.user_id);
  if (!ids.length) {
    $("friendsList").innerHTML = '<div class="person-empty">Aún no tienes amigos. Busca un username arriba para enviar tu primera solicitud.</div>';
    $("friendsSubtitle").textContent = "0 personas";
    $("friendCount").textContent = "0";
    return;
  }
  const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,status").in("id", ids);
  if (profilesError) {
    $("friendsList").innerHTML = `<div class="person-empty">${escapeHtml(readableError(profilesError))}</div>`;
    return;
  }
  $("friendsSubtitle").textContent = `${profiles.length} ${profiles.length === 1 ? "persona" : "personas"}`;
  $("friendCount").textContent = profiles.length;
  $("friendsList").innerHTML = profiles.map((p) => personCard(p, `<button class="button button-ghost" data-remove-friend="${p.id}">Eliminar amigo</button>`)).join("");
  document.querySelectorAll("[data-remove-friend]").forEach((btn) => btn.addEventListener("click", () => removeFriend(btn.dataset.removeFriend)));
}
function personCard(p, actions = "") {
  return `<article class="person-card panel"><div class="person-top"><img class="avatar avatar-lg" src="${escapeHtml(avatarUrl(p))}" alt=""><div class="person-details"><strong>${escapeHtml(p.display_name || p.username)}</strong><span>@${escapeHtml(p.username)}</span></div></div><p class="person-bio">${escapeHtml(p.status || p.bio || "Todavía no ha añadido una descripción.")}</p><div class="person-actions">${actions}</div></article>`;
}
async function removeFriend(personId) {
  if (!confirm("¿Quieres eliminar a esta persona de tus amigos?")) return;
  const { error } = await supabase.from("friendships").delete()
    .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${personId}),and(user_id.eq.${personId},friend_id.eq.${currentUser.id})`);
  if (error) return notify(readableError(error));
  notify("Amigo eliminado.");
  await loadFriends();
  await loadCounts();
}

async function loadRequests() {
  if (!currentUser) return;
  const [{ data: incoming, error: inError }, { data: outgoing, error: outError }] = await Promise.all([
    supabase.from("friend_requests").select("id,sender_id,created_at,profiles:sender_id(id,username,display_name,avatar_url,bio,status)").eq("receiver_id", currentUser.id).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("friend_requests").select("id,receiver_id,created_at,profiles:receiver_id(id,username,display_name,avatar_url,bio,status)").eq("sender_id", currentUser.id).eq("status", "pending").order("created_at", { ascending: false })
  ]);
  // Some Supabase projects cannot infer the aliased profile relation for these foreign keys;
  // use a second profile query as a compatible fallback.
  if (inError || outError) {
    await loadRequestsFallback();
    return;
  }
  $("incomingRequests").innerHTML = incoming?.length ? incoming.map((r) => personCard(r.profiles || {}, `<button class="button accept" data-accept="${r.id}">Aceptar</button><button class="button decline" data-decline="${r.id}">Rechazar</button>`)).join("") : '<div class="person-empty">No tienes solicitudes recibidas.</div>';
  $("outgoingRequests").innerHTML = outgoing?.length ? outgoing.map((r) => personCard(r.profiles || {}, `<button class="button button-ghost" data-cancel="${r.id}">Cancelar solicitud</button>`)).join("") : '<div class="person-empty">No tienes solicitudes enviadas pendientes.</div>';
  bindRequestButtons();
  await loadCounts();
}
async function loadRequestsFallback() {
  const { data: incoming, error: inError } = await supabase.from("friend_requests").select("id,sender_id,created_at").eq("receiver_id", currentUser.id).eq("status", "pending");
  const { data: outgoing, error: outError } = await supabase.from("friend_requests").select("id,receiver_id,created_at").eq("sender_id", currentUser.id).eq("status", "pending");
  if (inError || outError) {
    $("incomingRequests").innerHTML = `<div class="person-empty">Error cargando solicitudes. Ejecuta el SQL actualizado. ${escapeHtml(readableError(inError || outError))}</div>`;
    $("outgoingRequests").innerHTML = "";
    return;
  }
  const ids = [...new Set([...(incoming || []).map((r) => r.sender_id), ...(outgoing || []).map((r) => r.receiver_id)])];
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,username,display_name,avatar_url,bio,status").in("id", ids) : { data: [] };
  const map = new Map((profiles || []).map((p) => [p.id, p]));
  $("incomingRequests").innerHTML = incoming?.length ? incoming.map((r) => personCard(map.get(r.sender_id) || {}, `<button class="button accept" data-accept="${r.id}">Aceptar</button><button class="button decline" data-decline="${r.id}">Rechazar</button>`)).join("") : '<div class="person-empty">No tienes solicitudes recibidas.</div>';
  $("outgoingRequests").innerHTML = outgoing?.length ? outgoing.map((r) => personCard(map.get(r.receiver_id) || {}, `<button class="button button-ghost" data-cancel="${r.id}">Cancelar solicitud</button>`)).join("") : '<div class="person-empty">No tienes solicitudes enviadas pendientes.</div>';
  bindRequestButtons();
  await loadCounts();
}
function bindRequestButtons() {
  document.querySelectorAll("[data-accept]").forEach((btn) => btn.addEventListener("click", () => respondRequest(btn.dataset.accept, true)));
  document.querySelectorAll("[data-decline]").forEach((btn) => btn.addEventListener("click", () => respondRequest(btn.dataset.decline, false)));
  document.querySelectorAll("[data-cancel]").forEach((btn) => btn.addEventListener("click", () => cancelRequest(btn.dataset.cancel)));
}
async function respondRequest(id, accept) {
  if (!currentUser) return;
  const { data: request, error: fetchError } = await supabase.from("friend_requests")
    .select("id,sender_id,receiver_id,status").eq("id", id).eq("receiver_id", currentUser.id).eq("status", "pending").single();
  if (fetchError) return notify("No se pudo cargar la solicitud: " + readableError(fetchError));
  if (accept) {
    // El usuario actual es el receptor; guardar una fila visible para ambos mediante consultas OR.
    const { error: friendError } = await supabase.from("friendships").insert({ user_id: request.sender_id, friend_id: request.receiver_id });
    if (friendError && !/duplicate|unique/i.test(friendError.message)) return notify("No se pudo guardar la amistad: " + readableError(friendError));
    const { error } = await supabase.from("friend_requests").update({ status: "accepted" }).eq("id", id).eq("receiver_id", currentUser.id);
    if (error) return notify("La amistad se guardó, pero no se actualizó la solicitud: " + readableError(error));
    notify("¡Ahora son amigos!");
  } else {
    const { error } = await supabase.from("friend_requests").update({ status: "rejected" }).eq("id", id).eq("receiver_id", currentUser.id);
    if (error) return notify(readableError(error));
    notify("Solicitud rechazada.");
  }
  await Promise.all([loadRequests(), loadCounts(), loadFriends()]);
}
async function cancelRequest(id) {
  const { error } = await supabase.from("friend_requests").delete().eq("id", id).eq("sender_id", currentUser.id);
  if (error) return notify(readableError(error));
  notify("Solicitud cancelada.");
  await Promise.all([loadRequests(), loadCounts()]);
}

// ---------------- CHAT PRIVADO Y GRUPOS ----------------
function shortDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
}
function closeChatRealtime() {
  if (chatRealtimeChannel) { supabase.removeChannel(chatRealtimeChannel); chatRealtimeChannel = null; }
}
async function loadChatHome() {
  if (!currentUser || !$ ("conversationList")) return;
  await Promise.all([loadConversationList(), loadChatFriends()]);
}
async function loadConversationList() {
  const target = $("conversationList");
  if (!target || !currentUser) return;
  const { data: memberships, error } = await supabase.from("conversation_members")
    .select("conversation_id,joined_at").eq("user_id", currentUser.id);
  if (error) { target.innerHTML = `<div class="person-empty">No se pudieron cargar chats: ${escapeHtml(readableError(error))}</div>`; return; }
  const ids = [...new Set((memberships || []).map(x => x.conversation_id))];
  if (!ids.length) { target.innerHTML = '<div class="person-empty">Todavía no tienes conversaciones.</div>'; return; }
  const { data: conversations, error: convError } = await supabase.from("conversations")
    .select("id,name,is_group,created_by,created_at").in("id", ids).order("created_at", { ascending: false });
  if (convError) { target.innerHTML = `<div class="person-empty">${escapeHtml(readableError(convError))}</div>`; return; }
  const { data: members } = await supabase.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids);
  const otherIds = [...new Set((members || []).map(m => m.user_id).filter(id => id !== currentUser.id))];
  const { data: profiles } = otherIds.length ? await supabase.from("profiles").select("id,username,display_name,avatar_url").in("id", otherIds) : { data: [] };
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));
  target.innerHTML = (conversations || []).map(c => {
    const otherMember = (members || []).find(m => m.conversation_id === c.id && m.user_id !== currentUser.id);
    const person = otherMember ? profileMap.get(otherMember.user_id) : null;
    const name = c.is_group ? (c.name || "Grupo") : (person?.display_name || person?.username || "Chat privado");
    const avatar = c.is_group ? fallbackAvatar(c.name || "Grupo") : avatarUrl(person || {});
    return `<button type="button" class="conversation-item ${activeConversationId === c.id ? "active" : ""}" data-open-conversation="${c.id}" data-group="${c.is_group ? "true" : "false"}" data-chat-name="${escapeHtml(name)}" data-chat-avatar="${escapeHtml(avatar)}"><img class="avatar" src="${escapeHtml(avatar)}" alt=""><span class="conversation-copy"><strong>${escapeHtml(name)}</strong><small>${c.is_group ? "Grupo" : "Mensaje privado"}</small></span></button>`;
  }).join("") || '<div class="person-empty">Todavía no tienes conversaciones.</div>';
  target.querySelectorAll("[data-open-conversation]").forEach(btn => btn.addEventListener("click", () => openConversation(btn.dataset.openConversation, btn.dataset.group === "true", btn.dataset.chatName, btn.dataset.chatAvatar)));
}
async function loadChatFriends() {
  const target = $("chatFriendsList");
  if (!target || !currentUser) return;
  const { data: links, error } = await supabase.from("friendships").select("user_id,friend_id")
    .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`);
  if (error) { target.innerHTML = `<div class="person-empty">${escapeHtml(readableError(error))}</div>`; return; }
  const ids = [...new Set((links || []).map(l => l.user_id === currentUser.id ? l.friend_id : l.user_id))];
  if (!ids.length) { target.innerHTML = '<div class="person-empty">Primero agrega amigos en la sección Amigos.</div>'; return; }
  const { data: people, error: pError } = await supabase.from("profiles").select("id,username,display_name,avatar_url").in("id", ids);
  if (pError) { target.innerHTML = `<div class="person-empty">${escapeHtml(readableError(pError))}</div>`; return; }
  target.innerHTML = (people || []).map(p => `<button type="button" class="chat-friend-item" data-start-chat="${p.id}"><img class="avatar" src="${escapeHtml(avatarUrl(p))}" alt=""><span class="conversation-copy"><strong>${escapeHtml(p.display_name || p.username)}</strong><small>@${escapeHtml(p.username)}</small></span></button>`).join("");
  target.querySelectorAll("[data-start-chat]").forEach(btn => btn.addEventListener("click", () => startPrivateChat(btn.dataset.startChat)));
}
async function startPrivateChat(friendId) {
  if (!currentUser || friendId === currentUser.id) return;
  const { data: links, error: friendError } = await supabase.from("friendships").select("id")
    .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${currentUser.id})`);
  if (friendError) return notify(readableError(friendError));
  if (!links?.length) return notify("Solo puedes escribir a personas que ya son tus amigos.");
  const { data: mine, error: memberError } = await supabase.from("conversation_members").select("conversation_id").eq("user_id", currentUser.id);
  if (memberError) return notify(readableError(memberError));
  const myConversationIds = (mine || []).map(x => x.conversation_id);
  if (myConversationIds.length) {
    const { data: conversations } = await supabase.from("conversations").select("id,name,is_group,created_by,created_at").in("id", myConversationIds).eq("is_group", false);
    for (const c of (conversations || [])) {
      const { data: members } = await supabase.from("conversation_members").select("user_id").eq("conversation_id", c.id);
      const memberIds = (members || []).map(m => m.user_id).sort();
      if (memberIds.length === 2 && memberIds.includes(friendId) && memberIds.includes(currentUser.id)) {
        const { data: p } = await supabase.from("profiles").select("id,username,display_name,avatar_url").eq("id", friendId).maybeSingle();
        await openConversation(c.id, false, p?.display_name || p?.username || "Chat privado", avatarUrl(p || {})); return;
      }
    }
  }
  const { data: conversation, error: createError } = await supabase.from("conversations").insert({ is_group: false, created_by: currentUser.id }).select("id,name,is_group,created_by,created_at").single();
  if (createError) return notify("No se pudo crear el chat: " + readableError(createError));
  const { error: addError } = await supabase.from("conversation_members").insert([{ conversation_id: conversation.id, user_id: currentUser.id }, { conversation_id: conversation.id, user_id: friendId }]);
  if (addError) { notify("No se pudieron añadir los participantes: " + readableError(addError)); return; }
  const { data: p } = await supabase.from("profiles").select("id,username,display_name,avatar_url").eq("id", friendId).maybeSingle();
  await loadConversationList();
  await openConversation(conversation.id, false, p?.display_name || p?.username || "Chat privado", avatarUrl(p || {}));
}
async function createGroupChat() {
  if (!currentUser) return;
  const { data: links, error } = await supabase.from("friendships").select("user_id,friend_id").or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`);
  if (error) return notify(readableError(error));
  const ids = [...new Set((links || []).map(l => l.user_id === currentUser.id ? l.friend_id : l.user_id))];
  if (!ids.length) return notify("Agrega al menos un amigo antes de crear un grupo.");
  const { data: people, error: pError } = await supabase.from("profiles").select("id,username,display_name").in("id", ids);
  if (pError) return notify(readableError(pError));
  const groupName = prompt("Nombre del grupo:");
  if (!groupName || !groupName.trim()) return;
  const choices = (people || []).map(p => `${p.id}|${p.display_name || p.username} (@${p.username})`).join("\n");
  const selectedRaw = prompt("Escribe los usernames separados por coma para añadir amigos:\n" + (people || []).map(p => `@${p.username}`).join(", "));
  if (!selectedRaw) return;
  const usernames = selectedRaw.split(",").map(x => x.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  const selected = (people || []).filter(p => usernames.includes(String(p.username).toLowerCase()));
  if (!selected.length) return notify("No reconocí ningún username de tus amigos.");
  const { data: conversation, error: createError } = await supabase.from("conversations").insert({ name: groupName.trim().slice(0, 80), is_group: true, created_by: currentUser.id }).select("id,name,is_group,created_by,created_at").single();
  if (createError) return notify("No se pudo crear el grupo: " + readableError(createError));
  const members = [{ conversation_id: conversation.id, user_id: currentUser.id }, ...selected.map(p => ({ conversation_id: conversation.id, user_id: p.id }))];
  const { error: addError } = await supabase.from("conversation_members").insert(members);
  if (addError) return notify("El grupo se creó, pero no se pudieron añadir los miembros: " + readableError(addError));
  notify("Grupo creado.");
  await loadConversationList();
  await openConversation(conversation.id, true, conversation.name, fallbackAvatar(conversation.name));
}
async function openConversation(id, isGroup, name, avatar) {
  activeConversationId = id;
  activeConversationIsGroup = isGroup;
  closeChatRealtime();
  $("chatEmpty").classList.add("hidden");
  $("chatActive").classList.remove("hidden");
  $("chatHeaderName").textContent = name || (isGroup ? "Grupo" : "Chat privado");
  $("chatHeaderSubtitle").textContent = isGroup ? "Chat grupal" : "Mensajes privados";
  $("chatHeaderAvatar").src = avatar || fallbackAvatar(name);
  setMessage("chatMessage", "");
  await loadMessages();
  chatRealtimeChannel = supabase.channel(`bakyhub-chat-${id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, payload => {
    if (payload.new?.sender_id !== currentUser?.id && activeConversationId === id) loadMessages();
  }).subscribe();
  await loadConversationList();
}
async function loadMessages() {
  if (!activeConversationId || !currentUser) return;
  const { data: messages, error } = await supabase.from("messages").select("id,conversation_id,sender_id,content,created_at")
    .eq("conversation_id", activeConversationId).order("created_at", { ascending: true }).limit(300);
  const target = $("messagesList");
  if (error) { target.innerHTML = `<div class="messages-empty">No se pudieron cargar los mensajes: ${escapeHtml(readableError(error))}</div>`; return; }
  target.innerHTML = (messages || []).map(m => `<div class="message-bubble ${m.sender_id === currentUser.id ? "mine" : ""}">${escapeHtml(m.content)}<small>${m.sender_id === currentUser.id ? "Tú · " : ""}${escapeHtml(shortDate(m.created_at))}</small></div>`).join("") || '<div class="messages-empty">Todavía no hay mensajes. ¡Escribe el primero!</div>';
  target.scrollTop = target.scrollHeight;
}
$("messageForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser || !activeConversationId) return;
  const content = $("messageInput").value.trim();
  if (!content) return;
  const button = $("sendMessageButton");
  setBusy(button, true, "Enviando…");
  const { error } = await supabase.from("messages").insert({ conversation_id: activeConversationId, sender_id: currentUser.id, content });
  setBusy(button, false);
  if (error) { setMessage("chatMessage", readableError(error), "error"); return; }
  $("messageInput").value = "";
  setMessage("chatMessage", "");
  await loadMessages();
});
$("newGroupButton").addEventListener("click", createGroupChat);
$("refreshChatsButton").addEventListener("click", loadChatHome);

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_IN" && session?.user && !currentUser) {
    await initializeApp(session.user);
  } else if (event === "SIGNED_OUT") {
    currentUser = null;
    currentProfile = null;
  }
});
(async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) await initializeApp(session.user);
  else {
    $("authPanel").classList.remove("hidden");
    VIEWS.forEach((id) => $(id)?.classList.add("hidden"));
  }
})();
