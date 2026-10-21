
/* ==========================================
   BakyHub — Aplicación principal
   Archivo: app.js
========================================== */

// 1. CONFIGURACIÓN DE SUPABASE
// Sustituye estos valores en el siguiente paso.
// Usa únicamente la URL del proyecto y la clave
// pública (publishable/anon). Nunca pongas la
// service_role ni una clave secreta aquí.

const SUPABASE_URL = "PEGA_AQUI_TU_URL_DE_SUPABASE";
const SUPABASE_KEY = "PEGA_AQUI_TU_CLAVE_PUBLICA";

let supabaseClient = null;
let currentUser = null;
let currentProfile = null;
let selectedMedia = null;
let previewUrl = null;
let toastTimeout = null;

// 2. ELEMENTOS DE LA PÁGINA

const $ = (id) => document.getElementById(id);

const authForm = $("authForm");
const authEmail = $("authEmail");
const authPassword = $("authPassword");
const authUsername = $("authUsername");
const authMessage = $("authMessage");
const postForm = $("postForm");
const postText = $("postText");
const postMedia = $("postMedia");
const postMessage = $("postMessage");
const postsList = $("postsList");
const authPanel = $("authPanel");
const toast = $("toast");

// 3. UTILIDADES

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("visible");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("visible");
  }, 3500);
}

function setMessage(element, message, isError = false) {
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#ff667d" : "#43d9a3";
}

function setBusy(button, busy, busyText = "Procesando...") {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function initials(name) {
  const clean = String(name || "B").trim();
  return clean.slice(0, 1).toUpperCase() || "B";
}

function formatDate(dateValue) {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function safeFileName(name) {
  const extension = name.split(".").pop().toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return `${crypto.randomUUID()}.${extension || "bin"}`;
}

// 4. INICIALIZAR SUPABASE

function initializeSupabase() {
  if (
    !window.supabase ||
    !SUPABASE_URL.startsWith("https://") ||
    SUPABASE_URL.includes("PEGA_AQUI") ||
    !SUPABASE_KEY ||
    SUPABASE_KEY.includes("PEGA_AQUI")
  ) {
    console.warn(
      "BakyHub: falta configurar la URL y la clave pública de Supabase."
    );

    setMessage(
      authMessage,
      "Falta conectar Supabase. Configura la URL y la clave pública.",
      true
    );

    return false;
  }

  try {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    return true;
  } catch (error) {
    console.error("Error inicializando Supabase:", error);
    setMessage(authMessage, "No se pudo iniciar la conexión.", true);
    return false;
  }
}

// 5. REGISTRO DE CUENTAS

async function registerAccount() {
  if (!supabaseClient) {
    showToast("Primero conecta Supabase.");
    return;
  }

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const username = authUsername.value.trim();

  if (!email || password.length < 8 || !username) {
    setMessage(
      authMessage,
      "Completa el correo, una contraseña de 8 caracteres o más y tu nombre.",
      true
    );
    return;
  }

  if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(username)) {
    setMessage(
      authMessage,
      "El nombre debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.",
      true
    );
    return;
  }

  const button = $("registerButton");
  setBusy(button, true, "Creando cuenta...");

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          username
        }
      }
    });

    if (error) throw error;

    if (data.session) {
      setMessage(authMessage, "Cuenta creada. ¡Bienvenido a BakyHub!");
    } else {
      setMessage(
        authMessage,
        "Registro enviado. Revisa tu correo para confirmar la cuenta."
      );
    }

    authUsername.value = "";
  } catch (error) {
    console.error(error);
    setMessage(authMessage, translateAuthError(error), true);
  } finally {
    setBusy(button, false);
  }
}

// 6. INICIAR SESIÓN

async function loginAccount() {
  if (!supabaseClient) {
    showToast("Primero conecta Supabase.");
    return;
  }

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const button = $("loginButton");

  if (!email || !password) {
    setMessage(authMessage, "Introduce tu correo y contraseña.", true);
    return;
  }

  setBusy(button, true, "Iniciando sesión...");

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    setMessage(authMessage, "Sesión iniciada correctamente.");
    showToast("¡Bienvenido a BakyHub!");
  } catch (error) {
    console.error(error);
    setMessage(authMessage, translateAuthError(error), true);
  } finally {
    setBusy(button, false);
  }
}

function translateAuthError(error) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }

  if (message.includes("already registered")) {
    return "Ese correo ya está registrado. Intenta iniciar sesión.";
  }

  if (message.includes("password")) {
    return "Revisa la contraseña. Debe cumplir los requisitos configurados.";
  }

  if (message.includes("rate limit")) {
    return "Demasiados intentos. Espera un momento y vuelve a probar.";
  }

  return error?.message || "Ocurrió un error. Inténtalo de nuevo.";
}

// 7. CERRAR SESIÓN

async function logoutAccount() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    console.error(error);
    showToast("No se pudo cerrar la sesión.");
    return;
  }

  showToast("Has cerrado sesión.");
}

// 8. ACTUALIZAR LA INTERFAZ DEL USUARIO

function updateUserInterface() {
  const loggedIn = Boolean(currentUser);
  const name =
    currentProfile?.username ||
    currentUser?.user_metadata?.username ||
    currentUser?.email?.split("@")[0] ||
    "Invitado";

  $("sidebarName").textContent = name;
  $("sidebarAvatar").textContent = initials(name);
  $("profileButton").textContent = initials(name);
  $("sidebarStatus").textContent = loggedIn
    ? "Conectado a BakyHub"
    : "Bienvenido a BakyHub";

  authPanel?.classList.toggle("hidden", loggedIn);
  $("composer")?.classList.toggle("hidden", !loggedIn);

  // Solo muestra el acceso si el rol fue consultado
  // desde la tabla protegida user_roles.
  $("adminNav").hidden = currentProfile?.role !== "admin";

  $("profileInfo").textContent = loggedIn
    ? `Usuario: ${name} · Correo: ${currentUser.email}`
    : "Inicia sesión para ver tu perfil.";

  if (!loggedIn) {
    postsList.innerHTML = `
      <article class="empty-state panel">
        <div class="empty-icon">✦</div>
        <h3>Explora BakyHub</h3>
        <p>Inicia sesión para participar en la comunidad.</p>
      </article>`;
  }
}

// 9. CARGAR PERFIL
// Requiere la tabla profiles del esquema SQL.

async function loadProfile() {
  currentProfile = null;

  if (!currentUser || !supabaseClient) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, username, avatar_url")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("No se pudo cargar el perfil:", error.message);
    return;
  }

  currentProfile = data || {
    username: currentUser.user_metadata?.username || "Usuario"
  };

  // El rol se consulta aparte. Nunca se confía en un rol
  // enviado desde los metadatos editables del usuario.
  const { data: roleRows, error: roleError } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", currentUser.id)
    .limit(1);

  if (!roleError && roleRows?.length) {
    currentProfile.role = roleRows[0].role;
  }

  updateUserInterface();
}

// 10. VIGILAR LA SESIÓN

async function handleSession(session) {
  currentUser = session?.user || null;
  currentProfile = null;

  updateUserInterface();

  if (currentUser) {
    await loadProfile();
    await loadPosts();
  } else {
    postsList.innerHTML = `
      <article class="empty-state panel">
        <div class="empty-icon">✦</div>
        <h3>Tu comunidad empieza aquí</h3>
        <p>Inicia sesión para ver y compartir publicaciones.</p>
      </article>`;
  }
}

async function startSessionListener() {
  if (!supabaseClient) return;

  const { data } = supabaseClient.auth.onAuthStateChange(
    (_event, session) => {
      // Evita operaciones de red dentro del callback inmediato
      // de autenticación.
      setTimeout(() => {
        handleSession(session);
      }, 0);
    }
  );

  const { data: sessionData, error } =
    await supabaseClient.auth.getSession();

  if (error) {
    console.error(error);
    return;
  }

  await handleSession(sessionData?.session || null);
}

// 11. VISTA PREVIA DEL ARCHIVO

postMedia?.addEventListener("change", () => {
  selectedMedia = postMedia.files?.[0] || null;

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  $("mediaPreview").replaceChildren();

  if (!selectedMedia) {
    $("fileName").textContent = "Sin archivo seleccionado";
    return;
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm"
  ];

  if (!allowedTypes.includes(selectedMedia.type)) {
    selectedMedia = null;
    postMedia.value = "";
    $("fileName").textContent = "Tipo de archivo no permitido";
    showToast("Selecciona una imagen o vídeo compatible.");
    return;
  }

  const maxSize = 50 * 1024 * 1024;

  if (selectedMedia.size > maxSize) {
    selectedMedia = null;
    postMedia.value = "";
    $("fileName").textContent = "Archivo demasiado grande";
    showToast("El archivo debe pesar 50 MB o menos.");
    return;
  }

  $("fileName").textContent = selectedMedia.name;
  previewUrl = URL.createObjectURL(selectedMedia);

  const media = document.createElement(
    selectedMedia.type.startsWith("video/") ? "video" : "img"
  );

  media.src = previewUrl;

  if (media.tagName === "VIDEO") {
    media.controls = true;
    media.preload = "metadata";
  } else {
    media.alt = "Vista previa de la publicación";
  }

  $("mediaPreview").appendChild(media);
});

// 12. SUBIR FOTO O VÍDEO A SUPABASE STORAGE

async function uploadMedia(file) {
  if (!currentUser || !supabaseClient) {
    throw new Error("Debes iniciar sesión para subir archivos.");
  }

  // No se confía únicamente en el nombre del archivo.
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("El tipo de archivo no está permitido.");
  }

  if (file.size > 50 * 1024 * 1024) {
    throw new Error("El archivo supera el límite de 50 MB.");
  }

  const path = `${currentUser.id}/${safeFileName(file.name)}`;

  const { data, error } = await supabaseClient.storage
    .from("post-media")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (error) throw error;

  // El bucket debe ser público para este ejemplo.
  // Para medios privados, usa URLs firmadas y un bucket privado.
  const { data: urlData } = supabaseClient.storage
    .from("post-media")
    .getPublicUrl(data.path);

  return {
    path: data.path,
    url: urlData.publicUrl,
    type: file.type
  };
}

// 13. CREAR PUBLICACIÓN

async function createPost(event) {
  event.preventDefault();

  if (!currentUser || !supabaseClient) {
    setMessage(postMessage, "Inicia sesión primero.", true);
    return;
  }

  const content = postText.value.trim();
  const file = selectedMedia;

  if (!content && !file) {
    setMessage(postMessage, "Escribe algo o adjunta un archivo.", true);
    return;
  }

  const button = $("publishButton");
  setBusy(button, true, "Publicando...");

  let uploadedPath = null;

  try {
    let media = null;

    if (file) {
      media = await uploadMedia(file);
      uploadedPath = media.path;
    }

    const payload = {
      user_id: currentUser.id,
      content,
      media_url: media?.url || null,
      media_type: media?.type || null,
      media_path: media?.path || null
    };

    const { error } = await supabaseClient
      .from("posts")
      .insert(payload);

    if (error) throw error;

    postForm.reset();
    selectedMedia = null;

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }

    $("mediaPreview").replaceChildren();
    $("fileName").textContent = "Sin archivo seleccionado";

    setMessage(postMessage, "¡Publicación creada!");
    showToast("Tu publicación ya está en BakyHub.");

    await loadPosts();
  } catch (error) {
    console.error("Error al publicar:", error);

    // Si la inserción falla después de subir el archivo,
    // intenta borrar el archivo huérfano.
    if (uploadedPath) {
      const { error: cleanupError } = await supabaseClient.storage
        .from("post-media")
        .remove([uploadedPath]);

      if (cleanupError) {
        console.warn("No se pudo limpiar el archivo:", cleanupError);
      }
    }

    setMessage(
      postMessage,
      error.message || "No se pudo publicar.",
      true
    );
  } finally {
    setBusy(button, false);
  }
}

// 14. CARGAR PUBLICACIONES

async function loadPosts() {
  if (!supabaseClient || !currentUser) return;

  postsList.innerHTML = `
    <article class="empty-state panel">
      <p>Cargando publicaciones...</p>
    </article>`;

  const { data, error } = await supabaseClient
    .from("posts")
    .select(`
      id,
      user_id,
      content,
      media_url,
      media_type,
      created_at,
      profiles (
        username,
        avatar_url
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error cargando publicaciones:", error);
    postsList.innerHTML = `
      <article class="empty-state panel">
        <h3>No se pudieron cargar las publicaciones</h3>
        <p>Comprueba las tablas y los permisos RLS de Supabase.</p>
      </article>`;
    return;
  }

  renderPosts(data || []);
}

function renderPosts(posts) {
  postsList.replaceChildren();

  if (!posts.length) {
    postsList.innerHTML = `
      <article class="empty-state panel">
        <div class="empty-icon">✦</div>
        <h3>Aún no hay publicaciones</h3>
        <p>¡Sé la primera persona en compartir algo!</p>
      </article>`;
    return;
  }

  for (const post of posts) {
    const profile = Array.isArray(post.profiles)
      ? post.profiles[0]
      : post.profiles;

    const author = profile?.username || "Usuario";
    const article = document.createElement("article");

    article.className = "post-card";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = initials(author);

    const header = document.createElement("div");
    header.className = "post-header";

    const authorInfo = document.createElement("div");
    authorInfo.className = "post-author";

    const authorName = document.createElement("strong");
    authorName.textContent = author;

    const date = document.createElement("small");
    date.textContent = formatDate(post.created_at);

    authorInfo.append(authorName, date);
    header.append(avatar, authorInfo);
    article.appendChild(header);

    if (post.content) {
      const content = document.createElement("div");
      content.className = "post-content";
      content.textContent = post.content;
      article.appendChild(content);
    }

    if (post.media_url && post.media_type) {
      if (
        post.media_type.startsWith("image/") ||
        post.media_type.startsWith("video/")
      ) {
        const media = document.createElement(
          post.media_type.startsWith("video/") ? "video" : "img"
        );

        media.className = "post-media";
        media.src = post.media_url;
        media.loading = "lazy";

        if (media.tagName === "VIDEO") {
          media.controls = true;
          media.preload = "metadata";
        } else {
          media.alt = "Archivo de la publicación";
        }

        article.appendChild(media);
      }
    }

    const actions = document.createElement("div");
    actions.className = "post-actions";

    const likeButton = document.createElement("button");
    likeButton.type = "button";
    likeButton.textContent = "♡ Me gusta";
    likeButton.addEventListener("click", () => {
      showToast("Los me gusta se activarán al añadir la tabla likes.");
    });

    const commentButton = document.createElement("button");
    commentButton.type = "button";
    commentButton.textContent = "Comentar";
    commentButton.addEventListener("click", () => {
      showToast("Los comentarios se añadirán en el siguiente módulo.");
    });

    actions.append(likeButton, commentButton);

    // No se muestra un botón de eliminar funcional todavía:
    // la eliminación requiere una política segura y una función propia.
    article.appendChild(actions);
    postsList.appendChild(article);
  }
}

// 15. BUSCAR EN LAS PUBLICACIONES YA CARGADAS

$("searchInput")?.addEventListener("input", (event) => {
  const query = event.target.value.trim().toLocaleLowerCase("es");

  for (const article of postsList.querySelectorAll(".post-card")) {
    article.hidden = !article.textContent
      .toLocaleLowerCase("es")
      .includes(query);
  }
});

// 16. NAVEGACIÓN

function showView(view) {
  const views = {
    feed: $("feedView"),
    messages: $("messagesView"),
    groups: $("groupsView"),
    profile: $("profileView"),
    admin: $("adminView")
  };

  if (!views[view]) return;

  if (view === "admin" && currentProfile?.role !== "admin") {
    showToast("No tienes permiso para acceder a esta sección.");
    return;
  }

  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("hidden", key !== view);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  if (view === "messages" || view === "groups") {
    showToast("Este módulo se conectará en los próximos pasos.");
  }
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.view);
  });
});

$("homeButton")?.addEventListener("click", () => {
  showView("feed");
});

$("messagesButton")?.addEventListener("click", () => {
  showView("messages");
});

$("profileButton")?.addEventListener("click", () => {
  showView("profile");
});

$("refreshButton")?.addEventListener("click", loadPosts);

// 17. CONECTAR FORMULARIOS

authForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  loginAccount();
});

$("registerButton")?.addEventListener("click", registerAccount);

postForm?.addEventListener("submit", createPost);

// 18. ARRANQUE

async function main() {
  updateUserInterface();

  if (!initializeSupabase()) return;

  await startSessionListener();
}

document.addEventListener("DOMContentLoaded", main);
