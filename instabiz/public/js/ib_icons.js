window.IB_ICONS = (function () {
	const _paths = {
		moon: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`,
		},
		users: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
		},
		user: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
		},
		calendar: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
		},
		sunrise: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><polyline points="8 6 12 2 16 6"/>`,
		},
		plus: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
		},
		undo: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.49"/>`,
		},
		phone: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.99 12 19.79 19.79 0 0 1 1.85 3.5 2 2 0 0 1 3.84 1.34h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.91 6.91l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>`,
		},
		file: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`,
		},
		eye: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
		},
		eye_off: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`,
		},
		map_pin: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
		},
		clock: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
		},
		trash: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`,
		},
		search: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
		},
		star: {
			vb: "0 0 24 24",
			stroke: true,
			d: `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
		},
	};

	function svg(name, size) {
		const icon = _paths[name];
		if (!icon) return "";
		const sz = size || 13;
		if (icon.stroke) {
			return `<svg width="${sz}" height="${sz}" viewBox="${icon.vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.d}</svg>`;
		}
		return `<svg width="${sz}" height="${sz}" viewBox="${icon.vb}" fill="none">${icon.d}</svg>`;
	}

	return { svg };
})();
