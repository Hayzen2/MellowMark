<script setup>
import '../map-compat.js';
import { ref, shallowRef, watch, onBeforeUnmount, nextTick } from 'vue';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText } from 'lucide-vue-next';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { findSourceAt } from '../synctex-navigation.mjs';
import workerUrl from '../pdf-worker.js?worker&url';
GlobalWorkerOptions.workerSrc = workerUrl;

const props = defineProps({
  bytes: { type: Object, default: null },
  stale: { type: Boolean, default: false },
  sourceMap: { type: Array, default: () => [] },
});
const emit = defineEmits(['source-jump']);
const canvas = ref(null);
const pdf = shallowRef(null);
const page = ref(1);
const pages = ref(0);
const zoom = ref(1);
const error = ref('');
const loading = ref(false);
let task;
let loadingTask;
let token = 0;
let renderedPage = null;
let renderedViewport = null;
async function cancelRenderTask() {
  const current = task;
  task = null;
  if (!current) return;
  current.cancel();
  try {
    await current.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') throw e;
  }
}
// Renders the current page of the PDF onto the canvas with the appropriate zoom and output scale.
async function paint() {
  const current = pdf.value;
  const el = canvas.value;
  if (!current || !el) return;
  await cancelRenderTask();
  const version = token;
  try {
    const p = await current.getPage(page.value);
    if (version !== token || !canvas.value) return;
    const viewport = p.getViewport({ scale: 1.3 * zoom.value });
    const maxPixels = 24_000_000;
    const outputScale = Math.min(
      Math.max(1, window.devicePixelRatio || 1),
      3,
      Math.sqrt(maxPixels / (viewport.width * viewport.height)),
    );
    el.width = Math.max(1, Math.ceil(viewport.width * outputScale));
    el.height = Math.max(1, Math.ceil(viewport.height * outputScale));
    el.style.width = `${viewport.width}px`;
    el.style.height = `${viewport.height}px`;
    const context = el.getContext('2d');
    renderedPage = p;
    renderedViewport = viewport;
    task = p.render({
      canvasContext: context,
      canvas: el,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    });
    await task.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') error.value = e.message || 'PDF preview failed';
  }
}
watch(
  () => props.bytes,
  async (value) => {
    const id = ++token;
    try {
      await cancelRenderTask();
      if (loadingTask) {
        const previous = loadingTask;
        loadingTask = null;
        await previous.destroy();
      }
      if (pdf.value) {
        const previous = pdf.value;
        pdf.value = null;
        renderedPage = null;
        renderedViewport = null;
        await previous.destroy();
      }
    } catch (e) {
      if (id === token) {
        error.value = e.message || 'PDF cleanup failed';
        loading.value = false;
      }
      return;
    }
    if (id !== token) return;
    pdf.value = null;
    pages.value = 0;
    page.value = 1;
    error.value = '';
    if (!value?.length) {
      loading.value = false;
      return;
    }
    loading.value = true;
    let currentLoadingTask;
    try {
      currentLoadingTask = getDocument({
        data: value instanceof Uint8Array ? new Uint8Array(value) : Uint8Array.from(value),
        isEvalSupported: false,
      });
      loadingTask = currentLoadingTask;
      const document = await currentLoadingTask.promise;
      if (id !== token) {
        await currentLoadingTask.destroy();
        return;
      }
      if (loadingTask === currentLoadingTask) loadingTask = null;
      pdf.value = document;
      pages.value = document.numPages;
      loading.value = false;
      await nextTick();
      await paint();
    } catch (e) {
      if (currentLoadingTask && loadingTask === currentLoadingTask) loadingTask = null;
      if (id === token) {
        error.value = e.message || 'PDF could not be opened';
        loading.value = false;
      }
    }
  },
  { immediate: true },
);
watch([page, zoom], () => paint());
function jumpToSource(event) {
  if (props.stale || !props.sourceMap.length || !renderedPage || !renderedViewport) return;
  const rect = canvas.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = ((event.clientX - rect.left) / rect.width) * renderedViewport.width;
  const y = ((event.clientY - rect.top) / rect.height) * renderedViewport.height;
  const [pdfX, pdfY] = renderedViewport.convertToPdfPoint(x, y);
  const [left, , , top] = renderedPage.view;
  const location = findSourceAt(
    props.sourceMap,
    page.value,
    (pdfX - left) * 65536,
    (top - pdfY) * 65536,
  );
  if (location) emit('source-jump', { file: location.file, line: location.line });
}
onBeforeUnmount(() => {
  token++;
  void (async () => {
    await cancelRenderTask();
    if (loadingTask) {
      const previous = loadingTask;
      loadingTask = null;
      await previous.destroy();
    }
    if (pdf.value) {
      const previous = pdf.value;
      pdf.value = null;
      await previous.destroy();
    }
  })().catch((e) => {
    console.error('PDF preview cleanup failed:', e);
  });
});
</script>
<template>
  <div class="flex h-full min-h-0 flex-col bg-[#eae3e8] dark:bg-[#17131b]">
    <div
      class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-rose-100 bg-white/90 px-3 text-xs dark:border-white/10 dark:bg-[#27202b]"
    >
      <div class="flex items-center gap-2 text-slate-500 dark:text-rose-100/70">
        <FileText :size="15" /> PDF output
        <span
          v-if="stale"
          class="rounded bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200"
          >Outdated · Recompile</span
        >
      </div>
      <div class="flex items-center gap-1">
        <span
          v-if="sourceMap.length && !stale"
          class="mr-2 hidden text-[10px] text-slate-400 sm:inline"
        >
          Click page text to jump to source
        </span>
        <button
          class="rounded p-1.5 hover:bg-rose-100 dark:hover:bg-white/10"
          :disabled="page <= 1"
          title="Previous page"
          @click="page--"
        >
          <ChevronLeft :size="15" />
        </button>
        <span class="min-w-12 text-center text-[11px]">{{ pages ? `${page}/${pages}` : '0/0' }}</span>
        <button
          class="rounded p-1.5 hover:bg-rose-100 dark:hover:bg-white/10"
          :disabled="page >= pages"
          title="Next page"
          @click="page++"
        >
          <ChevronRight :size="15" />
        </button>
        <span class="mx-1 h-4 w-px bg-rose-200 dark:bg-white/10"></span>
        <button
          class="rounded p-1.5 hover:bg-rose-100 dark:hover:bg-white/10"
          :disabled="!pages || zoom <= 0.5"
          title="Zoom out"
          @click="zoom = Math.max(0.5, zoom - 0.15)"
        >
          <ZoomOut :size="15" />
        </button>
        <span class="min-w-10 text-center text-[11px]">{{ Math.round(zoom * 100) }}%</span>
        <button
          class="rounded p-1.5 hover:bg-rose-100 dark:hover:bg-white/10"
          :disabled="!pages || zoom >= 2"
          title="Zoom in"
          @click="zoom = Math.min(2, zoom + 0.15)"
        >
          <ZoomIn :size="15" />
        </button>
      </div>
    </div>
    <div class="preview-scroll min-h-0 flex-1 overflow-auto p-4 text-center sm:p-6">
      <div v-if="loading" class="py-16 text-sm text-slate-500">Loading PDF…</div>
      <div v-else-if="error" class="rounded-xl bg-rose-50 p-5 text-sm text-rose-800">{{ error }}</div>
      <div v-else-if="!pages" class="py-16 text-sm text-slate-400">
        Compile your LaTeX to show the PDF here.
      </div>
      <canvas
        v-show="pages"
        ref="canvas"
        class="mx-auto max-w-none bg-white shadow-xl"
        :class="sourceMap.length && !stale ? 'cursor-text' : ''"
        aria-label="Compiled PDF page"
        title="Click text to jump to its source line"
        @click="jumpToSource"
      ></canvas>
    </div>
  </div>
</template>
