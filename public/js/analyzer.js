// === UI helpers (no intrusivos) ===
const $ = (s, r = document) => r.querySelector(s);
const backdrop = $("#backdrop");
const toastEl  = $("#toast");

function loading(on) {
  if (!backdrop) return;
  backdrop.classList.toggle("show", !!on);
}

// Bloquea/desbloquea el Paso 1 para evitar dobles submits
function toast(msg, type = "info") {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.borderColor = (type === "error") ? "#ef4444" : "#2dd4bf";
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 3200);
}

function busy(btn, on, txtIdle="Descargar", txtBusy="Procesando…") {
  if (!btn) return;
  btn.dataset.busy = on ? "1" : "0";
  if (on) { btn.dataset._old = btn.textContent; btn.textContent = txtBusy; }
  else if (btn.dataset._old) { btn.textContent = btn.dataset._old; delete btn.dataset._old; }
}

function lockForm(on) {
  if (!uploadForm) return;
  if (fileInput) fileInput.disabled = !!on;
  if (submitBtn) submitBtn.disabled = !!on;
  const lbl = document.querySelector('.section-upload .file-label');
  if (lbl) lbl.setAttribute('aria-disabled', on ? 'true' : 'false');
}


const uploadForm = document.getElementById('uploadForm');
const excelBtn   = document.getElementById('downloadSheetBtn');
const wordBtn    = document.getElementById('downloadPdfBtn');

// Webhook POST (análisis)
const webhookUrl = 'https://n8n.149-130-187-171.sslip.io/webhook/3034612b-c6ad-4372-871e-8a65ffc8b626';

// Deriva la base de n8n (usa /webhook-test si el POST también es test)
//construir una url base para la deacarga, creando una url absoluta y añadiendo webhook test o webhook dependiendo del origen
const N8N_BASE = (() => {
try {
const u = new URL(webhookUrl);
const isTest = u.pathname.startsWith('/webhook-test/');
return `${u.origin}${isTest ? '/webhook-test' : '/webhook'}`;
} catch {
return (location.hostname === 'localhost')
    ? 'http://localhost:5678/webhook-test'
    : `${location.origin}/webhook`;
}
})();

// === Autenticación Basic (en memoria) ===  
let AUTH_HEADER = null;

async function pedirCredenciales() {
const user = prompt('Usuario:');
const pass = prompt('Contraseña:');
if (!user || !pass) throw new Error('Se requiere autenticación');
AUTH_HEADER = 'Basic ' + btoa(`${user}:${pass}`); //se cifra user, y pass en base64 con el objetivo de que navegue en el header del url http. 
} //se guarda en Authheader la construccion de la cadena con usuario y contraseña siempre y cuando sean campos no vacios. 

// Wrapper fetch con Authorization + reintento ante 401
async function fetchAuth(url, opts = {}, reintento = false) {
const headers = new Headers(opts.headers || {});
if (AUTH_HEADER) headers.set('Authorization', AUTH_HEADER); //agregamos en el header la autenticacion. 
const res = await fetch(url, { ...opts, headers, cache: 'no-store' });
if (res.status === 401 && !reintento) {
try { await pedirCredenciales(); } catch {}
return fetchAuth(url, opts, true);
}
return res; //aqui se valida la autenticacion segun el Auth ingresado haciendo fetch a la url. 
}

// Utilidades de descarga
function descargarBlob(blob, nombre) {
const url = URL.createObjectURL(blob); //crea una url temporal que aputna al blob (archivo binario)
const a = document.createElement('a');
a.href = url; //creamos un elemento anchor y hacemos que apunte a un url.
a.download = nombre || 'archivo';
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
} //recibe un archivo binario (Blob), genera una URL temporal en memoria y simula un clic, en un enlace invisible
//  para que el navegador muestre la descarga con el nombre indicado; luego limpia todo liberando la URL.

function nombreDesdeDisposition(res, fallback = 'archivo') {
const cd = res.headers.get('Content-Disposition') || res.headers.get('content-disposition') || '';
const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
try {
if (m && m[1]) return decodeURIComponent(m[1]);
if (m && m[2]) return m[2];
} catch {}
return fallback;
}  //esta funcion intenta extraer el nombre del erchvio desde el los headers. 

// Pedir credenciales al cargar
(async () => {
try { await pedirCredenciales(); } catch {}
})();

// URL de descarga XLSX: si el POST te dio sheetUrl, úsalo; si no, endpoint fijo
function getXlsxUrl() {
return (window.sheetUrl && String(window.sheetUrl)) || `${N8N_BASE}/download/xlsx?t=${Date.now()}`;
}

const excelResp = document.getElementById('excelResponse');
const wordResp  = document.getElementById('wordResponse');

if (excelBtn) excelBtn.disabled = true; //no se puede interactuar con el
if (wordBtn)  wordBtn.disabled  = true;

const fileInput    = document.getElementById('pdfInput');
const fileLabel    = document.querySelector('.section-upload .file-label');
const fileListEl   = document.getElementById('fileList');
const filesSummary = document.getElementById('filesSummary');
const submitBtn    = document.querySelector('#uploadForm .btn-action');

let selectedFiles = []; // fuente de verdad

function updatePreview() {
selectedFiles = selectedFiles.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')); // filtra solo pdfs validos.

const totalMB = selectedFiles.reduce((a,f)=>a+f.size,0) / (1024*1024); //calcula el peso en megabytes.
const hasFiles = selectedFiles.length > 0;

filesSummary.hidden = !hasFiles;
if (hasFiles) {
filesSummary.textContent = `${selectedFiles.length} archivo${selectedFiles.length===1?'':'s'} · ${totalMB.toFixed(1)} MB`;
}  //si se tiene archivos en text content imprimimos cuantos y cuantos pesan. 

fileListEl.innerHTML = selectedFiles.map((f, i) =>
`<li class="file-item">
    <span>${f.name}</span>
    <button type="button" aria-label="Quitar ${f.name}" data-remove="${i}">×</button>
    </li>`
).join(''); // agregamos una lista con cada archivo y una opcion de remove. 

submitBtn.disabled = !hasFiles;
if (excelBtn) excelBtn.disabled = true; // se habilita tras el POST exitoso, despues de que hasfiles >0
}

fileInput.addEventListener('change', (e) => {
selectedFiles = Array.from(e.target.files);
try { validarSeleccion(selectedFiles); }
catch (err) { toast(err.message, 'error'); selectedFiles = []; if (fileInput) fileInput.value = ''; }
updatePreview();
});


//dragenter → detecta cuando el cursor con el archivo entra en la zona.
//dragover → permite mantener activo el estilo mientras el cursor está encima y además habilita que se pueda soltar ahí (si no haces preventDefault(), el navegador no permite drop).
//dragleave → detecta cuando el archivo salió de la zona sin soltarlo. Así quitas el estilo “activo”. drop → detecta cuando realmente suelta(s) el archivo dentro de la zona.
['dragenter','dragover'].forEach(ev =>
fileLabel.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); fileLabel.classList.add('dragover'); })
); //permitimos eventos para arrastrar archvios en el fileLabel (input), evitamos el comportamiento por defecto que es que se abren , 

['dragleave','drop'].forEach(ev =>
fileLabel.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); fileLabel.classList.remove('dragover'); })
);

fileLabel.addEventListener('drop', (e) => {
selectedFiles = Array.from(e.dataTransfer.files);
try { validarSeleccion(selectedFiles); }
catch (err) { toast(err.message, 'error'); selectedFiles = []; }
updatePreview();
});

fileListEl.addEventListener('click', (e) => {
if (e.target.matches('button[data-remove]')) {
const idx = Number(e.target.getAttribute('data-remove'));
selectedFiles.splice(idx, 1);
updatePreview();
}
});

const MAX_FILES = 3;           // o el que quieras
const MAX_MB_PER_FILE = 25;     // 25 MB por archivo

function validarSeleccion(files) {
  if (!files.length) throw new Error('Selecciona al menos un PDF.');
  if (files.length > MAX_FILES) throw new Error(`Máximo ${MAX_FILES} archivos.`);
  const muyGrandes = files.filter(f => (f.size/(1024*1024)) > MAX_MB_PER_FILE);
  if (muyGrandes.length) throw new Error(`Hay ${muyGrandes.length} archivo(s) > ${MAX_MB_PER_FILE} MB.`);
}

uploadForm.addEventListener('submit', async (e) => {
e.preventDefault();

// Evita doble-click mientras envías
if (uploadForm.dataset.loading === '1') return;
uploadForm.dataset.loading = '1';
lockForm(true);
loading(true);
busy(submitBtn, true, "Analizar archivos", "Subiendo…");

// Estado inicial (limpia y bloquea)
window.sheetUrl = null;
window.pdfUrl   = null;
if (wordBtn)  wordBtn.disabled  = true;
if (excelBtn) excelBtn.disabled = true;
if (wordResp)  wordResp.textContent  = 'Generando PDF...';
if (excelResp) excelResp.textContent = '';

try {
// Timeout opcional (10 min) para el POST
const ac = new AbortController();
const to = setTimeout(() => ac.abort(new Error('timeout')), 700000);

// Prepara FormData
const files = selectedFiles.length ? selectedFiles : Array.from(fileInput.files);
validarSeleccion(files);    
const fd = new FormData(); //formdata sirve para empaquetar datos y enviar por pteicion http. 
files.forEach(f => fd.append('files', f)); //añadimos cada archvio al form data

const res = await fetchAuth(webhookUrl, { method: 'POST', body: fd, signal: ac.signal }); // enviamos en el body los rhcivos al webhook
clearTimeout(to);
if (!res.ok) throw new Error(`POST falló (${res.status})`);

// Parse robusto
const ct = res.headers.get('content-type') || ''; //guardamos en que formato viene la repsuesta 
const data = ct.includes('application/json') ? await res.json() : JSON.parse(await res.text());

// Actualiza y NORMALIZA URLs al origen de n8n, este bloque es el que se 
// encarga de tomar las URLs que devuelve n8n y adaptarlas para que funcionen en el frontend.

window.sheetUrl = data.sheetUrl || data.excelUrl || null;
window.pdfUrl   = data.pdfUrl   || data.wordUrl  || data.pdfPath || null;// buscamos el url del archivo de diferentes maneras



const base = new URL(N8N_BASE).origin; // ej: https://n8n.149-130-187-171.sslip.io, arreglamos la url, agragandole la base. 
if (window.sheetUrl) {
    if (window.sheetUrl.startsWith('/')) window.sheetUrl = base + window.sheetUrl; //si el servidor devolvio url relativa agragamos base.
    window.sheetUrl = window.sheetUrl.replace(/^http:\/\/localhost:5678/, base);
}
if (window.pdfUrl) {
    if (window.pdfUrl.startsWith('/')) window.pdfUrl = base + window.pdfUrl;
    window.pdfUrl = window.pdfUrl.replace(/^http:\/\/localhost:5678/, base);
}

// Habilita botones y mensajes
excelBtn.disabled = false;
excelResp.textContent = 'Hoja lista para descargar.';

if (window.pdfUrl) {
    wordBtn.disabled = false;
    wordResp.textContent = 'PDF listo para descargar.';
} else {
    wordBtn.disabled = true;
    wordResp.textContent = 'No se recibió URL de PDF.';
}

document.getElementById('uploadResponse').innerText = JSON.stringify(data, null, 2);
toast('Análisis listo');
} catch (err) {
console.error(err);
const msg = err?.message === 'timeout'
    ? 'La generación tardó demasiado. Inténtalo de nuevo.'
    : `Error generando el PDF: ${err?.message || 'desconocido'}`;
if (wordResp) wordResp.textContent = msg;
document.getElementById('uploadResponse').innerText = (err && (err.stack || err.message)) || String(err);
toast(msg, 'error');
} finally {
uploadForm.dataset.loading = '0';
submitBtn.disabled = !selectedFiles.length;
lockForm(false);
loading(false);
busy(submitBtn, false);
}
});

// Descargar PDF con Auth
wordBtn.onclick = async () => {
  if (!window.pdfUrl) { alert('Aún estamos generando el PDF…'); return; }
  try {
    loading(true);
    busy(wordBtn, true, "Descargar PDF", "Descargando…");
    wordBtn.disabled = true;

    const sep = window.pdfUrl.includes('?') ? '&' : '?';
    const res = await fetchAuth(`${window.pdfUrl}${sep}t=${Date.now()}`, { cache: 'no-store' });

    if (!res.ok) throw new Error('No se pudo obtener el PDF');
    const blob = await res.blob();
    const nombre = nombreDesdeDisposition(res, (new URL(window.pdfUrl)).searchParams.get('name') || 'Analisis.pdf');
    descargarBlob(blob, nombre);
    toast('PDF descargado');
  } catch (err) {
    alert(err.message || 'Error descargando el PDF');
    toast(err.message || 'Error descargando el PDF', 'error');
  } finally {
    wordBtn.disabled = false;
    busy(wordBtn, false);
    loading(false);
  }
};


// Descargar XLSX con Auth (ya no se usa navegación directa)
excelBtn.onclick = async () => {
  const url = getXlsxUrl();
  if (!url) { alert('Aún no hay hoja lista. Sube los PDFs primero.'); return; }
  try {
    loading(true);
    busy(excelBtn, true, "Descargar hoja", "Descargando…");
    excelBtn.disabled = true;

    const res = await fetchAuth(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo obtener la hoja');
    const blob = await res.blob();
    const nombre = nombreDesdeDisposition(res, 'Comparador.xlsx');
    descargarBlob(blob, nombre);
    toast('XLSX descargado');
  } catch (e) {
    alert(e.message || 'Error descargando la hoja');
    toast(e.message || 'Error descargando la hoja', 'error');
  } finally {
    excelBtn.disabled = false;
    busy(excelBtn, false);
    loading(false);
  }
};


const btnClear = document.getElementById('btnClear');
btnClear?.addEventListener('click', () => {
  selectedFiles = [];
  if (fileInput) fileInput.value = "";
  updatePreview();
  excelBtn.disabled = true; wordBtn.disabled = true;
  if (excelResp) excelResp.textContent = "";
  if (wordResp)  wordResp.textContent  = "";
  document.getElementById('uploadResponse').innerText = "";
  toast("Listo. Puedes cargar nuevos archivos.");
});


// Evita Enter/click durante carga
uploadForm?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && uploadForm.dataset.loading === '1') e.preventDefault();
});
fileInput?.addEventListener('click', (e) => {
  if (uploadForm.dataset.loading === '1') e.preventDefault();
});


