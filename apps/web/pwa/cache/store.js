// المخزن مشترك بين PWA وإضافات APK، ومكانه lib/ حتى لا يستورد الـAPK شيئًا من pwa/
export { createStore, SPACES } from '../../lib/idb-store.js';
