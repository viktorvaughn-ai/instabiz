const CACHE = "ib-checkin-v1";
const SHELL = ["/checkin"];

self.addEventListener("install", e => {
	e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
	self.skipWaiting();
});

self.addEventListener("activate", e => {
	e.waitUntil(caches.keys().then(keys =>
		Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
	));
	self.clients.claim();
});

self.addEventListener("fetch", e => {
	// Only intercept navigation to /checkin — pass API calls through
	if (e.request.mode === "navigate") {
		e.respondWith(
			fetch(e.request).catch(() => caches.match("/checkin"))
		);
	}
});
