
/* ==========================================
   BAKYHUB — APP.JS
   Autenticación, perfiles y publicaciones
   ========================================== */

const SUPABASE_URL = "https://imaslowgszmefgabjbvl.supabase.co";
const SUPABASE_KEY = "sb_publishable__A9yM6nUmtCeTeWT-atEXg_neodznEG";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let currentUser = null;
let currentProfile = null;
let selectedMedia = null;

// Elementos HTML
const $ = (id) => document.getElementById(id);

function showMessage(elementId, message, isError = false) {
  const element = $(elementId);
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#ff7777" : "#79e6ad";
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) {
    console.log(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => toast.classList.remove("show"), 3000);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatDate(date) {
  return new Date(date).toLocaleString("es-SV", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

/* ==========================================
   REGISTRO
   ========================================== */

async function registerUser(event) {
  event?.preventDefault();

  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;
  const username = $("authUsername")?.value.trim();

  if (!email || !password || !username) {
    showMessage("authMessage", "Completa todos los campos.", true);
    return;
  }

  if (username.length < 3 || username.length > 24) {
    showMessage(
      "authMessage",
      "El usuario debe tener entre 3 y 24 caracteres.",
      true
    );
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showMessage(
      "authMessage",
      "Usa solo letras, números y guion bajo en el usuario.",
      true
    );
    return;
  }

  if (password.length < 6) {
    showMessage(
      "authMessage",
      "La contraseña debe tener al menos 6 caracteres.",
      true
    );
    return;
  }

  const button = $("registerButton");
  if (button) button.disabled = true;

  try {
    showMessage("authMessage", "Creando tu cuenta...");

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    });

    if (error) throw error;

    if (data.session) {
      showMessage("authMessage", "¡Cuenta creada! Bienvenido a BakyHub.");
    } else {
      showMessage(
        "authMessage",
        "Cuenta creada. Revisa tu correo para confirmar el registro."
      );
    }

    if ($("authPassword")) $("authPassword").value = "";
  } catch (error) {
    console.error("Error al registrar:", error);
    showMessage("authMessage", error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

/* ==========================================
   INICIO DE SESIÓN
   ========================================== */

async function loginUser(event) {
  event?.preventDefault();

  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;

  if (!email || !password) {
    showMessage("authMessage", "Escribe tu correo y contraseña.", true);
    return;
  }

  const button = $("loginButton");
  if (button) button.disabled = true;

  try {
    showMessage("authMessage", "Iniciando sesión...");

    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    showMessage("authMessage", "¡Has iniciado sesión!");
  } catch (error) {
    console.error("Error al iniciar sesión:", error);
    showMessage("authMessage", error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function logoutUser() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    showToast("No se pudo cerrar sesión.");
    console.error(error);
    return;
  }

  currentUser = null;
  currentProfile = null;
  showToast("Sesión cerrada.");
  await updateInterface();
}

/* ==========================================
   PERFIL Y ROL
   ========================================== */

async function loadProfile() {
  if (!currentUser) {
    currentProfile = null;
    return;
  }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("id, username, avatar_url, bio")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("Error cargando perfil:", error);
  }

  const { data: roleRows, error: roleError } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", currentUser.id)
    .limit(1);

  if (roleError) console.error("Error cargando rol:", roleError);

  currentProfile = {
    id: currentUser.id,
    username:
      profile?.username ||
      currentUser.user_metadata?.username ||
      currentUser.email?.split("@")[0] ||
      "Usuario",
    avatar_url: profile?.avatar_url || null,
    bio: profile?.bio || "",
    role: roleRows?.[0]?.role || "user"
  };
}

async function updateInterface() {
  const loggedIn = Boolean(currentUser);

  if ($("authPanel")) {
    $("authPanel").hidden = loggedIn;
  }

  if ($("composer")) {
    $("composer").hidden = !loggedIn;
  }

  if ($("sidebarName")) {
    $("sidebarName").textContent =
      currentProfile?.username || "Invitado";
  }

  if ($("sidebarAvatar")) {
    $("sidebarAvatar").textContent =
      (currentProfile?.username || "B").charAt(0).toUpperCase();
  }

  if ($("sidebarStatus")) {
    $("sidebarStatus").textContent = loggedIn
      ? "Conectado"
      : "Explorando BakyHub";
  }

  if ($("adminNav")) {
    $("adminNav").hidden =
      !["admin", "moderator"].includes(currentProfile?.role);
  }

  if ($("profileInfo")) {
    $("profileInfo").textContent = loggedIn
      ? `Perfil: ${currentProfile?.username || "Usuario"}`
      : "Inicia sesión para ver tu perfil.";
  }

  await loadPosts();
}

/* ==========================================
   PUBLICACIONES
   ========================================== */

async function loadPosts() {
  const container = $("postsList");
  if (!container) return;

  container.innerHTML = "<p>Cargando publicaciones...</p>";

  const { data: posts, error } = await supabaseClient
    .from("posts")
    .select(`
      id,
      user_id,
      content,
      media_url,
      media_type,
      created_at
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error cargando publicaciones:", error);
    container.textContent =
      "No se pudieron cargar las publicaciones. Revisa la configuración de Supabase.";
    return;
  }

  if (!posts?.length) {
    container.innerHTML =
      "<p class='empty-state'>Todavía no hay publicaciones. ¡Sé el primero!</p>";
    return;
  }

  const userIds = [...new Set(posts.map((post) => post.user_id))];

  const { data: profiles } = await supabaseClient
    .from("profiles")
    .select("id, username, avatar_url")
    .in("id", userIds);

  const profileMap = new Map(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  container.replaceChildren();

  for (const post of posts) {
    const author = profileMap.get(post.user_id);
    const card = document.createElement("article");
    card.className = "post-card";

    const heading = document.createElement("div");
    heading.className = "post-author";

    const avatar = document.createElement("div");
    avatar.className = "post-avatar";
    avatar.textContent = (author?.username || "U").charAt(0).toUpperCase();

    const authorInfo = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = author?.username || "Usuario";
    const date = document.createElement("small");
    date.textContent = formatDate(post.created_at);

    authorInfo.append(name, date);
    heading.append(avatar, authorInfo);
    card.append(heading);

    if (post.content) {
      const content = document.createElement("p");
      content.className = "post-content";
      content.textContent = post.content;
      card.append(content);
    }

    if (post.media_url) {
      if (post.media_type?.startsWith("image/")) {
        const image = document.createElement("img");
        image.src = post.media_url;
        image.alt = "Imagen de la publicación";
        image.loading = "lazy";
        image.className = "post-media";
        card.append(image);
      } else if (post.media_type?.startsWith("video/")) {
        const video = document.createElement("video");
        video.src = post.media_url;
        video.controls = true;
        video.preload = "metadata";
        video.className = "post-media";
        card.append(video);
      }
    }

    if (currentUser?.id === post.user_id) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Eliminar publicación";
      deleteButton.className = "delete-post";
      deleteButton.addEventListener("click", () => deletePost(post));
      card.append(deleteButton);
    }

    container.append(card);
  }
}

async function publishPost(event) {
  event?.preventDefault();

  if (!currentUser) {
    showToast("Inicia sesión para publicar.");
    return;
  }

  const content = $("postText")?.value.trim() || "";
  const file = selectedMedia;

  if (!content && !file) {
    showMessage(
      "postMessage",
      "Escribe algo o selecciona una foto o vídeo.",
      true
    );
    return;
  }

  if (content.length > 5000) {
    showMessage("postMessage", "La publicación es demasiado larga.", true);
    return;
  }

  let mediaUrl = null;
  let mediaPath = null;
  let mediaType = null;

  try {
    if ($("publishButton")) $("publishButton").disabled = true;

    showMessage("postMessage", "Publicando...");

    if (file) {
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm"
      ];

      if (!allowedTypes.includes(file.type)) {
        throw new Error("Formato de archivo no permitido.");
      }

      if (file.size > 50 * 1024 * 1024) {
        throw new Error("El archivo no puede superar 50 MB.");
      }

      const extension = file.name.split(".").pop().toLowerCase();
      mediaPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabaseClient.storage
        .from("post-media")
        .upload(mediaPath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabaseClient.storage
        .from("post-media")
        .getPublicUrl(mediaPath);

      mediaUrl = publicData.publicUrl;
      mediaType = file.type;
    }

    const { error } = await supabaseClient.from("posts").insert({
      user_id: currentUser.id,
      content,
      media_url: mediaUrl,
      media_type: mediaType,
      media_path: mediaPath
    });

    if (error) {
      if (mediaPath) {
        await supabaseClient.storage
          .from("post-media")
          .remove([mediaPath]);
      }
      throw error;
    }

    if ($("postText")) $("postText").value = "";
    if ($("postMedia")) $("postMedia").value = "";
    if ($("fileName")) $("fileName").textContent = "";
    if ($("mediaPreview")) $("mediaPreview").replaceChildren();

    selectedMedia = null;

    showMessage("postMessage", "¡Publicación creada!");
    await loadPosts();
  } catch (error) {
    console.error("Error publicando:", error);
    showMessage("postMessage", error.message, true);
  } finally {
    if ($("publishButton")) $("publishButton").disabled = false;
  }
}

async function deletePost(post) {
  if (!currentUser || post.user_id !== currentUser.id) {
    showToast("No puedes eliminar esta publicación.");
    return;
  }

  if (!confirm("¿Seguro que quieres eliminar esta publicación?")) return;

  const { error } = await supabaseClient
    .from("posts")
    .delete()
    .eq("id", post.id)
    .eq("user_id", currentUser.id);

  if (error) {
    console.error(error);
    showToast("No se pudo eliminar la publicación.");
    return;
  }

  if (post.media_path) {
    const { error: storageError } = await supabaseClient.storage
      .from("post-media")
      .remove([post.media_path]);

    if (storageError) {
      console.error("No se pudo eliminar el archivo:", storageError);
    }
  }

  showToast("Publicación eliminada.");
  await loadPosts();
}

/* ==========================================
   ARCHIVOS MULTIMEDIA
   ========================================== */

function handleMediaSelection(event) {
  const file = event.target.files?.[0] || null;
  selectedMedia = file;

  if ($("fileName")) {
    $("fileName").textContent = file
      ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
      : "";
  }

  const preview = $("mediaPreview");
  if (!preview) return;

  preview.replaceChildren();

  if (!file) return;

  const url = URL.createObjectURL(file);

  if (file.type.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "Vista previa";
    image.className = "media-preview";
    preview.append(image);
  } else if (file.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.className = "media-preview";
    preview.append(video);
  }
}

/* ==========================================
   NAVEGACIÓN
   ========================================== */

function showView(viewId) {
  const viewIds = [
    "feedView",
    "messagesView",
    "groupsView",
    "profileView",
    "adminView"
  ];

  for (const id of viewIds) {
    const view = $(id);
    if (view) view.hidden = id !== viewId;
  }

  if (viewId === "messagesView") {
    showToast("El chat todavía necesita sus tablas y funciones.");
  } else if (viewId === "groupsView") {
    showToast("Los grupos se implementarán en el siguiente paso.");
  } else if (viewId === "adminView") {
    if (!["admin", "moderator"].includes(currentProfile?.role)) {
      showToast("No tienes permisos para acceder a esta sección.");
      showView("feedView");
      return;
    }

    showToast("El panel de moderación todavía está en desarrollo.");
  } else if (viewId === "profileView" && currentProfile) {
    if ($("profileInfo")) {
      $("profileInfo").textContent =
        `Usuario: ${currentProfile.username}\n` +
        `Rol: ${currentProfile.role}\n` +
        `Correo: ${currentUser.email || ""}\n` +
        `Biografía: ${currentProfile.bio || "Sin biografía"}`;
    }
  }

  if (viewId === "feedView") loadPosts();
}

/* ==========================================
   EVENTOS
   ========================================== */

function setupEvents() {
  $("authForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  $("registerButton")?.addEventListener("click", registerUser);
  $("loginButton")?.addEventListener("click", loginUser);

  $("postForm")?.addEventListener("submit", publishPost);
  $("postMedia")?.addEventListener("change", handleMediaSelection);

  $("refreshButton")?.addEventListener("click", loadPosts);
  $("homeButton")?.addEventListener("click", () => showView("feedView"));
  $("messagesButton")?.addEventListener("click", () => showView("messagesView"));
  $("profileButton")?.addEventListener("click", () => showView("profileView"));
  $("adminNav")?.addEventListener("click", () => showView("adminView"));

  $("searchInput")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();

    document.querySelectorAll(".post-card").forEach((post) => {
      post.hidden = !post.textContent.toLowerCase().includes(query);
    });
  });
}

/* ==========================================
   INICIALIZACIÓN Y SESIÓN
   ========================================== */

async function handleSession(session) {
  currentUser = session?.user || null;

  try {
    await loadProfile();
    await updateInterface();
  } catch (error) {
    console.error("Error inicializando BakyHub:", error);
    showToast("Ocurrió un problema al cargar tu cuenta.");
  }
}

async function initializeBakyHub() {
  setupEvents();

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Error obteniendo sesión:", error);
    showToast("No se pudo comprobar la sesión.");
  }

  await handleSession(data?.session || null);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    // Evitar operaciones de autenticación dentro del callback síncrono.
    setTimeout(() => handleSession(session), 0);
  });

  // Actualizar el feed cuando haya publicaciones nuevas.
  supabaseClient
    .channel("bakyhub-posts-live")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "posts"
      },
      () => loadPosts()
    )
    .subscribe();
}

document.addEventListener("DOMContentLoaded", initializeBakyHub);
