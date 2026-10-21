/* Evita que el archivo inicialice dos veces si el navegador lo carga duplicado. */
if (!window.__BAKYHUB_APP_LOADED__) {
  window.__BAKYHUB_APP_LOADED__ = true;

/* BakyHub: frontend público. Las reglas de seguridad reales deben estar en Supabase RLS. */
const SUPABASE_URL = "https://imaslowgszmefgabjbvl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__A9yM6nUmtCeTeWT-atEXg_neodznEG";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const VIEWS = ["feedView", "friendsView", "requestsView", "profileView"];
let currentUser = null;
let currentProfile = null;
let authMode = "login";
let selectedMedia = null;
let toastTimer = null;

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
  const { data: request, error: fetchError } = await supabase.from("friend_requests").select("id,sender_id,receiver_id,status").eq("id", id).eq("receiver_id", currentUser.id).single();
  if (fetchError) return notify(readableError(fetchError));
  if (accept) {
    const [user_id, friend_id] = [request.sender_id, request.receiver_id].sort();
    const { error: friendError } = await supabase.from("friendships").insert({ user_id, friend_id });
    if (friendError && !/duplicate|unique/i.test(friendError.message)) return notify(readableError(friendError));
    const { error } = await supabase.from("friend_requests").update({ status: "accepted" }).eq("id", id);
    if (error) return notify(readableError(error));
    notify("¡Ahora son amigos!");
  } else {
    const { error } = await supabase.from("friend_requests").update({ status: "declined" }).eq("id", id);
    if (error) return notify(readableError(error));
    notify("Solicitud rechazada.");
  }
  await Promise.all([loadRequests(), loadCounts()]);
}
async function cancelRequest(id) {
  const { error } = await supabase.from("friend_requests").delete().eq("id", id).eq("sender_id", currentUser.id);
  if (error) return notify(readableError(error));
  notify("Solicitud cancelada.");
  await Promise.all([loadRequests(), loadCounts()]);
}

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


} // fin de protección contra carga duplicada
