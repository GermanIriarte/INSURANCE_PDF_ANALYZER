// ./public/js/merge.js  (module)
const mergeForm  = document.querySelector('#mergePdfs');
const mergeInput = document.querySelector('#mergeInput');
const mergeBtn   = mergeForm?.querySelector('button[type="submit"]');

let mergeFiles = [];
const USE_CLIENT_MERGE = true;

setupMergeUI();

function suggestMergedName(files) {
  const first = (files[0]?.name || 'PDFs').replace(/\.pdf$/i, '');
  const more  = files.length > 1 ? ` (+${files.length - 1})` : '';
  const d = new Date();
  return `Unificado - ${first}${more} ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.pdf`;
}
function sanitizePdfName(input, fallback='unificado.pdf'){
  let name = (input || fallback).trim().replace(/\.pdf$/i,'');
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\\/:*?"<>|]+/g,'-').trim();
  if (!name) name = 'unificado';
  return `${name}.pdf`;
}

function setupMergeUI() {
  if (!mergeForm || !mergeInput || !mergeBtn) return;

  mergeInput.addEventListener('change', (e) => {
    mergeFiles = Array.from(e.target.files || []);
    try { validarSeleccionMerge(mergeFiles); }
    catch (err) {
      window.toast?.(err.message || 'Selección inválida', 'error');
      mergeFiles = []; mergeInput.value = '';
    }
    updateMergePreview(mergeFiles);
    mergeBtn.disabled = mergeFiles.length < 2;
  });

  // Quitar uno por uno
  document.querySelector('#mergeFileList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-remove]');
    if (!btn) return;
    const idx = Number(btn.dataset.remove);
    mergeFiles.splice(idx, 1);
    updateMergePreview(mergeFiles);
    mergeBtn.disabled = mergeFiles.length < 2;
  });

  // Limpiar todo
  document.getElementById('btnMergeClear')?.addEventListener('click', () => {
    mergeFiles = [];
    mergeInput.value = '';
    updateMergePreview([]);
    mergeBtn.disabled = true;
  });

  mergeForm.addEventListener('submit', onMergeSubmit);
}

async function onMergeSubmit(e) {
  e.preventDefault();
  if (!mergeFiles.length) return;

  mergeFiles.sort((a,b)=>a.name.localeCompare(b.name, undefined, {numeric:true}));

  // 1) Pide nombre antes de procesar
  const suggested = suggestMergedName(mergeFiles);
  const userInput = prompt('¿Cómo quieres llamar el PDF final?', suggested);
  if (userInput === null) return; // cancelado
  const finalName = sanitizePdfName(userInput, suggested);

  try {
    window.loading?.(true);
    window.busy?.(mergeBtn, true, 'Unir PDFs', 'Uniendo...');

    const resultBlob = USE_CLIENT_MERGE
      ? await mergePdfsClient(mergeFiles)
      : await mergePdfsServer(mergeFiles);

    // 2) Lo añadimos al Paso 1 (no se puede escribir en <input type="file">)
    const mergedFile = new File([resultBlob], finalName, { type: 'application/pdf', lastModified: Date.now() });
    window.addFilesToUpload?.([mergedFile]); // <-- definido en analyzer.js

    // Descarga opcional inmediata
    downloadBlob(resultBlob, finalName);
    window.toast?.('PDF unificado correctamente');

    // Reset UI de merge
    mergeFiles = [];
    mergeInput.value = '';
    updateMergePreview([]);
    mergeBtn.disabled = true;

  } catch (err) {
    window.toast?.(err.message || 'Error uniendo PDFs', 'error');
  } finally {
    window.busy?.(mergeBtn, false);
    window.loading?.(false);
  }
}

function validarSeleccionMerge(files) {
  if (files.length < 2) throw new Error('Selecciona al menos 2 archivos PDF.');
  const notPdf = files.find(f => f.type !== 'application/pdf');
  if (notPdf) throw new Error(`Solo PDFs. Revisa: ${notPdf.name}`);
  const totalMB = files.reduce((a,f)=>a+f.size,0)/1e6;
  if (totalMB > 80) throw new Error('La selección total supera 80 MB.');
}

function updateMergePreview(files) {
  const summary = document.querySelector('#mergeSummary');
  const list    = document.querySelector('#mergeFileList');
  if (!summary || !list) return;

  const has = files.length > 0;
  summary.hidden = !has;
  summary.textContent = has ? `${files.length} archivo(s) seleccionados` : '';
  list.innerHTML = has ? files.map((f,i)=>`
    <li class="file-item" title="${f.name}">
      <span>${f.name}</span>
      <button type="button" class="btn-remove" data-remove="${i}" aria-label="Quitar ${f.name}">×</button>
    </li>
  `).join('') : '';
}

async function mergePdfsClient(files) {
  const lib = window.PDFLib || window['pdf-lib'];
  if (!lib?.PDFDocument) throw new Error('pdf-lib no está cargado. Asegura el <script> del CDN antes de merge.js');
  const { PDFDocument } = lib;

  const mergedPdf = await PDFDocument.create();
  for (const f of files) {
    const bytes = await f.arrayBuffer();
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await mergedPdf.copyPages(src, src.getPageIndices());
    pages.forEach(p => mergedPdf.addPage(p));
  }
  const mergedBytes = await mergedPdf.save({ addDefaultPage:false, useObjectStreams:false });
  return new Blob([mergedBytes], { type:'application/pdf' });
}

async function mergePdfsServer(files) {
  const fd = new FormData();
  files.forEach(f => fd.append('files', f, f.name));
  const res = await fetch('/api/merge', { method:'POST', body: fd });
  if (!res.ok) throw new Error('No se pudo unir PDFs en el servidor');
  return await res.blob();
}

function downloadBlob(blob, filename='merge.pdf'){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}
