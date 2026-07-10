frappe.pages["ib-org-chart"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Org Chart",
		single_column: true,
	});
	new IbOrgChart(page, wrapper);
};

const OC = {
	EMP_W: 250, EMP_H: 82,
	DEPT_W: 200, DEPT_H: 58,
	BRANCH_W: 185, BRANCH_H: 66,
	DX: 290, DY: 130,
	AVATAR_R: 22,
	TRANSITION: 420,
	DEPT_COLORS: [
		"#d97757","#2e74b5","#70ad47","#7b5ea7","#e8a838",
		"#26a69a","#e05c8a","#5c85d6","#8d6e63","#546e7a",
	],
};

class IbOrgChart {
	constructor(page, wrapper) {
		this.page = page;
		this.$main = $(wrapper).find(".layout-main-section");
		this._raw = [];
		this._status_filter = "Active";
		this._dept_filter = null;
		this._search_q = "";
		this._d3_ready = false;
		this._svg = null;
		this._g = null;
		this._zoom_behavior = null;
		this._root = null;
		this._dept_color_cache = {};
		this._tooltip_el = null;
		this._inject_styles();
		this._build_toolbar();
		this._build_layout();
		this._load_d3();
	}

	// ── Toolbar ───────────────────────────────────────────────────────────────

	_build_toolbar() {
		const self = this;
		this.page.add_field({
			fieldname: "oc_search",
			fieldtype: "Data",
			label: "Search",
			placeholder: "Name or designation…",
			change() {
				self._search_q = (this.get_value() || "").toLowerCase().trim();
				self._apply_search();
			},
		});
		this.page.add_field({
			fieldname: "oc_dept",
			fieldtype: "Link",
			label: "Department",
			options: "Department",
			change() {
				self._dept_filter = this.get_value() || null;
				self._reload();
			},
		});
		this.page.add_field({
			fieldname: "oc_status",
			fieldtype: "Select",
			label: "Status",
			options: "Active\nLeft\nAll",
			default: "Active",
			change() {
				self._status_filter = this.get_value() || "Active";
				self._reload();
			},
		});
		const _ic = (name) => `<iconify-icon icon="lucide:${name}" width="12" height="12" style="vertical-align:middle;margin-right:4px"></iconify-icon>`;
		this.page.add_inner_button(`${_ic("maximize-2")} Expand All`, () => self._toggle_all(true));
		this.page.add_inner_button(`${_ic("minimize-2")} Collapse All`, () => self._toggle_all(false));
		this.page.add_inner_button(`${_ic("download")} Export PNG`, () => self._export_png());
		this.page.add_inner_button(`${_ic("maximize")} Fit to Screen`, () => self._fit());
	}

	// ── Layout ────────────────────────────────────────────────────────────────

	_build_layout() {
		this.$main.html(`
			<div class="ib-oc-wrap">
				<div class="ib-oc-loading" id="ib-oc-loading">Loading…</div>
				<svg class="ib-oc-svg" id="ib-oc-svg">
					<defs>
						<filter id="ib-oc-shadow" x="-20%" y="-20%" width="140%" height="140%">
							<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#00000014"/>
						</filter>
						<filter id="ib-oc-shadow-h" x="-25%" y="-25%" width="150%" height="150%">
							<feDropShadow dx="0" dy="5" stdDeviation="10" flood-color="#d9775730"/>
						</filter>
						<pattern id="ib-oc-dots" width="28" height="28" patternUnits="userSpaceOnUse">
							<circle cx="14" cy="14" r="1.1" fill="#c4c9d8" opacity="0.5"/>
						</pattern>
						<radialGradient id="ib-oc-bg-fade" cx="50%" cy="10%" r="70%">
							<stop offset="0%" stop-color="#f8f9fc" stop-opacity="0.9"/>
							<stop offset="100%" stop-color="#f8f9fc" stop-opacity="0"/>
						</radialGradient>
					</defs>
					<rect width="100%" height="100%" fill="#f5f7fb"/>
					<rect width="100%" height="100%" fill="url(#ib-oc-dots)"/>
					<rect width="100%" height="55%" fill="url(#ib-oc-bg-fade)"/>
					<g class="ib-oc-root-g" id="ib-oc-root-g"></g>
				</svg>
				<div class="ib-oc-legend-wrap" id="ib-oc-legend-wrap">
					<div class="ib-oc-legend-header">
						<span class="ib-oc-legend-title">Departments</span>
						<button class="ib-oc-legend-clear" id="ib-oc-legend-clear" style="display:none">Clear</button>
					</div>
					<div class="ib-oc-legend" id="ib-oc-legend"></div>
				</div>
				<div class="ib-oc-zoom-bar" id="ib-oc-zoom-bar">
					<button class="ib-oc-zoom-btn" id="ib-oc-zoom-out" title="Zoom out">−</button>
					<span class="ib-oc-zoom-pct" id="ib-oc-zoom-pct">100%</span>
					<button class="ib-oc-zoom-btn" id="ib-oc-zoom-in" title="Zoom in">+</button>
					<button class="ib-oc-zoom-btn ib-oc-zoom-fit" id="ib-oc-zoom-fit" title="Fit to screen">⊞</button>
				</div>
				<div class="ib-oc-tooltip" id="ib-oc-tooltip"></div>
			</div>
		`);
		this._tooltip_el = document.getElementById("ib-oc-tooltip");
	}

	// ── D3 ────────────────────────────────────────────────────────────────────

	_load_d3() {
		if (window.d3) { this._d3_ready = true; this._reload(); return; }
		const s = document.createElement("script");
		s.src = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js";
		s.onload = () => { this._d3_ready = true; this._reload(); };
		s.onerror = () => frappe.show_alert({ message: "Failed to load D3.js", indicator: "red" });
		document.head.appendChild(s);
	}

	_reload() {
		if (!this._d3_ready) return;
		const loading = document.getElementById("ib-oc-loading");
		if (loading) { loading.textContent = "Loading…"; loading.style.display = "flex"; }
		frappe.call({
			method: "instabiz.instabiz.page.ib_org_chart.ib_org_chart.get_org_data",
			args: { status_filter: this._status_filter },
			callback: (r) => {
				if (loading) loading.style.display = "none";
				if (!r.message) return;
				this._raw = r.message;
				const tree_data = this._build_tree(r.message);
				this._init_svg();
				this._render(tree_data);
				this._build_legend();
			},
			error: () => { if (loading) loading.textContent = "Failed to load data."; },
		});
	}

	// ── Tree builder ──────────────────────────────────────────────────────────

	_build_tree(employees) {
		const emp_map = {};
		employees.forEach(e => {
			emp_map[e.name] = {
				id: e.name, type: "employee",
				emp_name: e.employee_name,
				designation: e.designation || "",
				department: e.department || "Unassigned",
				reports_to: e.reports_to || null,
				status: e.status,
				location: e.custom_location_state || "",
				gender: e.gender || "",
				date_of_joining: e.date_of_joining || "",
				company: e.company || "",
				direct_reports: e.direct_reports || 0,
				children: [],
			};
		});

		const no_manager = employees.filter(e => !e.reports_to);
		const root_emp = no_manager.sort((a, b) => (b.direct_reports || 0) - (a.direct_reports || 0))[0] || employees[0];
		const root = emp_map[root_emp.name];

		const FACTORY_DEPTS = new Set([
			"Factory Management - IB", "Factory Production - IB", "Factory Administration - IB",
		]);

		const office_branch = {
			id: "__branch__office", type: "branch",
			branch_name: "Office", department: "Office", children: [],
		};
		const factory_branch = {
			id: "__branch__factory", type: "branch",
			branch_name: "Factory", department: "Factory", children: [],
		};

		const dept_nodes = {};
		const get_dept = (dept) => {
			if (!dept_nodes[dept]) {
				dept_nodes[dept] = { id: `__dept__${dept}`, type: "dept", dept_name: dept, department: dept, children: [] };
			}
			return dept_nodes[dept];
		};

		employees.forEach(e => {
			if (e.name === root.id) return;
			const node = emp_map[e.name];
			if (!node) return;
			if (this._dept_filter && e.department !== this._dept_filter) return;

			if (e.reports_to && emp_map[e.reports_to] && e.reports_to !== root.id) {
				emp_map[e.reports_to].children.push(node);
				return;
			}
			get_dept(e.department || "Unassigned").children.push(node);
		});

		Object.values(dept_nodes).forEach(dn => {
			dn.children.sort((a, b) => (a.emp_name || "").localeCompare(b.emp_name || ""));
		});

		Object.values(dept_nodes).forEach(dn => {
			if (this._dept_filter && dn.dept_name !== this._dept_filter) return;
			(FACTORY_DEPTS.has(dn.dept_name) ? factory_branch : office_branch).children.push(dn);
		});

		office_branch.children.sort((a, b) => a.dept_name.localeCompare(b.dept_name));
		factory_branch.children.sort((a, b) => a.dept_name.localeCompare(b.dept_name));

		if (office_branch.children.length) root.children.push(office_branch);
		if (factory_branch.children.length) root.children.push(factory_branch);

		return root;
	}

	// ── SVG init ──────────────────────────────────────────────────────────────

	_init_svg() {
		const d3 = window.d3;
		const svg_el = document.getElementById("ib-oc-svg");
		const g_el = document.getElementById("ib-oc-root-g");
		if (!svg_el) return;

		d3.select(g_el).selectAll("*").remove();
		this._svg = d3.select(svg_el);
		this._g = d3.select(g_el);

		this._zoom_behavior = d3.zoom()
			.scaleExtent([0.1, 3])
			.on("zoom", (event) => {
				this._g.attr("transform", event.transform);
				this._hide_tooltip();
			});

		this._svg
			.call(this._zoom_behavior)
			.on("dblclick.zoom", null)
			.on("click.hide_tt", () => this._hide_tooltip());
	}

	// ── Render ────────────────────────────────────────────────────────────────

	_render(data) {
		const d3 = window.d3;
		if (!this._g) return;

		this._root = d3.hierarchy(data, d => d.children);
		this._root.x0 = 0;
		this._root.y0 = 0;
		this._root.descendants().forEach((d, i) => { d._uid = i; });

		// Start collapsed: dept nodes collapsed, branches open
		this._root.children?.forEach(branch => {
			branch.children?.forEach(dept => this._collapse(dept));
		});

		this._update(this._root);
		setTimeout(() => this._fit(), OC.TRANSITION + 100);
	}

	_collapse(d) {
		if (d.children) {
			d._children = d.children;
			d._children.forEach(c => this._collapse(c));
			d.children = null;
		}
	}

	// ── Update (core D3 pattern) ──────────────────────────────────────────────

	_update(source) {
		const d3 = window.d3;
		const self = this;
		if (!this._root) return;

		const tree = d3.tree().nodeSize([OC.DX, OC.DY]);
		tree(this._root);

		const nodes = this._root.descendants();
		const links = this._root.links();
		const g = this._g;
		const dur = OC.TRANSITION;
		const src_x0 = source.x0 ?? source.x ?? 0;
		const src_y0 = source.y0 ?? source.y ?? 0;

		// ── Links ──
		const link = g.selectAll(".ib-oc-link").data(links, d => `${d.source._uid}-${d.target._uid}`);

		const link_enter = link.enter().append("path")
			.attr("class", "ib-oc-link")
			.attr("d", () => self._link_path(
				{ x: src_x0, y: src_y0, data: source.data },
				{ x: src_x0, y: src_y0, data: source.data },
			));

		link.merge(link_enter)
			.transition().duration(dur)
			.attr("d", d => self._link_path(d.source, d.target));

		link.exit()
			.transition().duration(dur)
			.attr("d", () => self._link_path(
				{ x: source.x, y: source.y, data: source.data },
				{ x: source.x, y: source.y, data: source.data },
			))
			.remove();

		// ── Nodes (enter) ──
		const node = g.selectAll(".ib-oc-node").data(nodes, d => d._uid);

		const node_enter = node.enter().append("g")
			.attr("class", "ib-oc-node")
			.attr("transform", `translate(${src_x0},${src_y0})`)
			.attr("cursor", "pointer")
			.on("click", function (event, d) {
				event.stopPropagation();
				self._hide_tooltip();
				const in_toggle = event.target.closest?.(".ib-oc-toggle-g");
				if (d.data.type === "employee" && !in_toggle) {
					// Open employee record
					frappe.set_route("Form", "Employee", d.data.id);
					return;
				}
				if (d.children) { d._children = d.children; d.children = null; }
				else if (d._children) { d.children = d._children; d._children = null; }
				self._update(d);
			})
			.on("mouseenter", function (event, d) {
				if (d.data.type !== "employee") return;
				d3.select(this).select(".ib-oc-card")
					.attr("filter", "url(#ib-oc-shadow-h)")
					.attr("stroke-width", 1.5)
					.attr("stroke", "#d97757");
				self._show_tooltip(event, d.data);
			})
			.on("mousemove", function (event, d) {
				if (d.data.type !== "employee") return;
				self._position_tooltip(event);
			})
			.on("mouseleave", function (event, d) {
				if (d.data.type !== "employee") return;
				d3.select(this).select(".ib-oc-card")
					.attr("filter", "url(#ib-oc-shadow)")
					.attr("stroke-width", 1)
					.attr("stroke", "#eaecf0");
				self._hide_tooltip();
			});

		// Draw static card content once on enter
		node_enter.each(function (d) {
			const el = d3.select(this);
			if (d.data.type === "branch") self._draw_branch_card(el, d);
			else if (d.data.type === "dept") self._draw_dept_card(el, d);
			else self._draw_emp_card(el, d);
		});

		// Store positions
		nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });

		const node_update = node.merge(node_enter);

		// Move to position
		node_update.transition().duration(dur)
			.attr("transform", d => `translate(${d.x},${d.y})`);

		// ── Update dynamic toggle indicator every render ──
		node_update.each(function (d) {
			const el = d3.select(this);
			el.select(".ib-oc-toggle-g").remove();

			const has = d.children || d._children;
			if (!has) return;
			const open = !!d.children;
			const tg = el.append("g").attr("class", "ib-oc-toggle-g");

			if (d.data.type === "branch") {
				tg.append("text")
					.attr("x", OC.BRANCH_W / 2 - 14)
					.attr("y", -OC.BRANCH_H / 2 + 16)
					.attr("text-anchor", "middle")
					.attr("class", "ib-oc-branch-arrow")
					.text(open ? "▾" : "▸");
			} else if (d.data.type === "dept") {
				tg.append("circle")
					.attr("cx", OC.DEPT_W / 2 - 13).attr("cy", -OC.DEPT_H / 2 + 13)
					.attr("r", 9)
					.attr("class", "ib-oc-toggle-circle")
					.attr("fill", open ? "#e8f4fd" : "#f3f4f6");
				tg.append("text")
					.attr("x", OC.DEPT_W / 2 - 13).attr("y", -OC.DEPT_H / 2 + 17)
					.attr("text-anchor", "middle")
					.attr("class", "ib-oc-toggle-icon")
					.attr("fill", open ? "#2e74b5" : "#888")
					.text(open ? "−" : "+");
			} else {
				tg.append("circle")
					.attr("cx", OC.EMP_W / 2 - 13).attr("cy", -OC.EMP_H / 2 + 13)
					.attr("r", 9)
					.attr("class", "ib-oc-toggle-circle")
					.attr("fill", open ? "#fff3ee" : "#e8f4fd");
				tg.append("text")
					.attr("x", OC.EMP_W / 2 - 13).attr("y", -OC.EMP_H / 2 + 17)
					.attr("text-anchor", "middle")
					.attr("class", "ib-oc-toggle-icon")
					.attr("fill", open ? "#d97757" : "#2e74b5")
					.text(open ? "−" : "+");
			}
		});

		// Exit
		node.exit()
			.transition().duration(dur)
			.attr("transform", `translate(${source.x},${source.y})`)
			.style("opacity", 0)
			.remove();
	}

	// ── Card drawing (class methods so `this` = IbOrgChart) ──────────────────

	_draw_emp_card(el, d) {
		const color = this._dept_color(d.data.department);
		const W = OC.EMP_W, H = OC.EMP_H;

		el.append("rect")
			.attr("x", -W / 2).attr("y", -H / 2)
			.attr("width", W).attr("height", H).attr("rx", 10)
			.attr("class", "ib-oc-card")
			.attr("filter", "url(#ib-oc-shadow)");

		// Left color bar
		el.append("rect")
			.attr("x", -W / 2).attr("y", -H / 2)
			.attr("width", 5).attr("height", H).attr("rx", 3)
			.attr("fill", color);

		// Avatar bg
		el.append("circle")
			.attr("cx", -W / 2 + 33).attr("cy", 0)
			.attr("r", OC.AVATAR_R + 1)
			.attr("fill", color).attr("opacity", 0.15);
		// Avatar fg
		el.append("circle")
			.attr("cx", -W / 2 + 33).attr("cy", 0)
			.attr("r", OC.AVATAR_R - 1)
			.attr("fill", color).attr("opacity", 0.2);
		// Initials
		el.append("text")
			.attr("x", -W / 2 + 33).attr("y", 5)
			.attr("text-anchor", "middle")
			.attr("class", "ib-oc-initials")
			.attr("fill", color)
			.text(_initials(d.data.emp_name));

		const tx = -W / 2 + 64;
		el.append("text").attr("x", tx).attr("y", -20).attr("class", "ib-oc-emp-name")
			.text(_truncate(d.data.emp_name, 26));
		el.append("text").attr("x", tx).attr("y", -5).attr("class", "ib-oc-desig")
			.text(_truncate(d.data.designation, 28));

		// Dept dot + label
		el.append("circle").attr("cx", tx).attr("cy", 14).attr("r", 3.5).attr("fill", color).attr("opacity", 0.65);
		el.append("text").attr("x", tx + 9).attr("y", 18).attr("class", "ib-oc-dept-label")
			.text(_truncate(_clean_dept(d.data.department), 24));

		// Direct reports badge
		if (d.data.direct_reports > 0) {
			el.append("rect")
				.attr("x", W / 2 - 44).attr("y", H / 2 - 18)
				.attr("width", 38).attr("height", 13).attr("rx", 6)
				.attr("fill", color).attr("opacity", 0.13);
			el.append("text")
				.attr("x", W / 2 - 25).attr("y", H / 2 - 8)
				.attr("text-anchor", "middle")
				.attr("class", "ib-oc-badge-text")
				.attr("fill", color)
				.text(`▸ ${d.data.direct_reports}`);
		}
	}

	_draw_branch_card(el, d) {
		const is_office = d.data.branch_name === "Office";
		const color = is_office ? "#2e74b5" : "#e8822a";
		const icon = is_office ? "🏢" : "🏭";
		const W = OC.BRANCH_W, H = OC.BRANCH_H;
		const count = _subtree_count(d);

		el.append("rect")
			.attr("x", -W / 2).attr("y", -H / 2)
			.attr("width", W).attr("height", H).attr("rx", 14)
			.attr("fill", color)
			.attr("filter", "url(#ib-oc-shadow)");

		// Glossy top strip
		el.append("rect")
			.attr("x", -W / 2 + 1).attr("y", -H / 2 + 1)
			.attr("width", W - 2).attr("height", H / 2 - 1).attr("rx", 13)
			.attr("fill", "rgba(255,255,255,0.13)");

		el.append("text")
			.attr("x", -W / 2 + 26).attr("y", 6)
			.attr("class", "ib-oc-branch-icon")
			.text(icon);

		el.append("text")
			.attr("x", -W / 2 + 52).attr("y", -6)
			.attr("class", "ib-oc-branch-name")
			.text(d.data.branch_name);

		el.append("text")
			.attr("x", -W / 2 + 52).attr("y", 12)
			.attr("class", "ib-oc-branch-count")
			.text(`${count} employees`);
	}

	_draw_dept_card(el, d) {
		const color = this._dept_color(d.data.dept_name);
		const W = OC.DEPT_W, H = OC.DEPT_H;
		const count = (d.children || d._children || []).length;

		el.append("rect")
			.attr("x", -W / 2).attr("y", -H / 2)
			.attr("width", W).attr("height", H).attr("rx", 8)
			.attr("class", "ib-oc-dept-card")
			.attr("filter", "url(#ib-oc-shadow)");

		// Top color accent
		el.append("rect")
			.attr("x", -W / 2).attr("y", -H / 2)
			.attr("width", W).attr("height", 4).attr("rx", 4)
			.attr("fill", color);

		el.append("text")
			.attr("x", 0).attr("y", -4)
			.attr("text-anchor", "middle")
			.attr("class", "ib-oc-dept-name")
			.text(_truncate(_clean_dept(d.data.dept_name), 22));

		el.append("text")
			.attr("x", 0).attr("y", 14)
			.attr("text-anchor", "middle")
			.attr("class", "ib-oc-dept-count")
			.text(`${count} member${count !== 1 ? "s" : ""}`);
	}

	// ── Link path (per-node-type height offsets) ──────────────────────────────

	_node_h(d) {
		if (!d?.data) return OC.EMP_H;
		if (d.data.type === "branch") return OC.BRANCH_H;
		if (d.data.type === "dept") return OC.DEPT_H;
		return OC.EMP_H;
	}

	_link_path(s, t) {
		const sy = s.y + this._node_h(s) / 2;
		const ty = t.y - this._node_h(t) / 2;
		const my = (sy + ty) / 2;
		return `M${s.x},${sy} C${s.x},${my} ${t.x},${my} ${t.x},${ty}`;
	}

	// ── Fit ───────────────────────────────────────────────────────────────────

	_fit() {
		const d3 = window.d3;
		const svg_el = document.getElementById("ib-oc-svg");
		if (!svg_el || !this._zoom_behavior || !this._root) return;
		const W = svg_el.clientWidth, H = svg_el.clientHeight;
		const nodes = this._root.descendants();
		if (!nodes.length) return;
		const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
		const x0 = Math.min(...xs) - OC.EMP_W, x1 = Math.max(...xs) + OC.EMP_W;
		const y0 = Math.min(...ys) - OC.EMP_H, y1 = Math.max(...ys) + OC.EMP_H;
		const k = Math.min(0.9, 0.9 * Math.min(W / (x1 - x0), H / (y1 - y0)));
		const tx = W / 2 - k * (x0 + x1) / 2;
		const ty = H / 2 - k * (y0 + y1) / 2;
		this._svg.transition().duration(600)
			.call(this._zoom_behavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
	}

	// ── Expand / collapse all ─────────────────────────────────────────────────

	_toggle_all(expand) {
		if (!this._root) return;
		this._root.descendants().forEach(d => {
			if (expand) {
				if (d._children) { d.children = d._children; d._children = null; }
			} else {
				if (d.children && d.depth > 0) { d._children = d.children; d.children = null; }
			}
		});
		this._update(this._root);
		setTimeout(() => this._fit(), OC.TRANSITION + 100);
	}

	// ── Search ────────────────────────────────────────────────────────────────

	_apply_search() {
		const q = this._search_q;
		const d3 = window.d3;
		if (!this._g) return;

		if (q) {
			this._root?.descendants().forEach(d => {
				if (d._children) { d.children = d._children; d._children = null; }
			});
			this._update(this._root);
		}

		setTimeout(() => {
			d3.selectAll(".ib-oc-node").each(function (d) {
				if (d.data.type !== "employee") return;
				const match = q && (
					(d.data.emp_name || "").toLowerCase().includes(q) ||
					(d.data.designation || "").toLowerCase().includes(q) ||
					(d.data.department || "").toLowerCase().includes(q)
				);
				d3.select(this).select(".ib-oc-card")
					.classed("ib-oc-card--match", !!match)
					.classed("ib-oc-card--dim", !!(q && !match));
			});

			if (q) {
				const match = this._root?.descendants().find(d =>
					d.data.type === "employee" && (
						(d.data.emp_name || "").toLowerCase().includes(q) ||
						(d.data.designation || "").toLowerCase().includes(q)
					)
				);
				if (match) this._zoom_to_node(match);
			}
		}, OC.TRANSITION + 50);
	}

	_zoom_to_node(d) {
		const d3 = window.d3;
		const svg_el = document.getElementById("ib-oc-svg");
		if (!svg_el || !this._zoom_behavior) return;
		const W = svg_el.clientWidth, H = svg_el.clientHeight;
		const k = 1.3;
		this._svg.transition().duration(500).call(
			this._zoom_behavior.transform,
			d3.zoomIdentity.translate(W / 2 - k * d.x, H / 2 - k * d.y).scale(k),
		);
	}

	// ── Tooltip ───────────────────────────────────────────────────────────────

	_show_tooltip(event, data) {
		if (!this._tooltip_el) return;
		const joined = data.date_of_joining
			? frappe.format(data.date_of_joining, { fieldtype: "Date" }) : "—";
		this._tooltip_el.innerHTML = `
			<div class="ib-oc-tt-name">${frappe.utils.escape_html(data.emp_name || "")}</div>
			<div class="ib-oc-tt-hint">Click to open record →</div>
			<div class="ib-oc-tt-row"><span class="ib-oc-tt-lbl">Role</span>${frappe.utils.escape_html(data.designation || "—")}</div>
			<div class="ib-oc-tt-row"><span class="ib-oc-tt-lbl">Dept</span>${frappe.utils.escape_html(_clean_dept(data.department))}</div>
			${data.location ? `<div class="ib-oc-tt-row"><span class="ib-oc-tt-lbl">State</span>${frappe.utils.escape_html(data.location)}</div>` : ""}
			<div class="ib-oc-tt-row"><span class="ib-oc-tt-lbl">Joined</span>${joined}</div>
			${data.direct_reports ? `<div class="ib-oc-tt-row"><span class="ib-oc-tt-lbl">Reports</span>${data.direct_reports} direct</div>` : ""}
		`;
		this._tooltip_el.classList.add("ib-oc-tooltip--visible");
		this._position_tooltip(event);
	}

	_position_tooltip(event) {
		if (!this._tooltip_el) return;
		const wrap = document.querySelector(".ib-oc-wrap");
		const rect = wrap?.getBoundingClientRect() || { left: 0, top: 0 };
		let x = event.clientX - rect.left + 16;
		let y = event.clientY - rect.top - 10;
		const tw = this._tooltip_el.offsetWidth || 200;
		const th = this._tooltip_el.offsetHeight || 120;
		if (x + tw > (wrap?.offsetWidth || 9999) - 8) x -= tw + 32;
		if (y + th > (wrap?.offsetHeight || 9999) - 8) y -= th + 20;
		this._tooltip_el.style.left = x + "px";
		this._tooltip_el.style.top = y + "px";
	}

	_hide_tooltip() {
		this._tooltip_el?.classList.remove("ib-oc-tooltip--visible");
	}

	// ── Legend ────────────────────────────────────────────────────────────────

	_build_legend() {
		const depts = [...new Set(this._raw.map(e => e.department || "Unassigned"))].sort();
		const counts = {};
		this._raw.forEach(e => {
			const d = e.department || "Unassigned";
			counts[d] = (counts[d] || 0) + 1;
		});

		const $legend = $("#ib-oc-legend").empty();
		const active = this._dept_highlight;

		depts.forEach(dept => {
			const color = this._dept_color(dept);
			const is_active = active === dept;
			$legend.append(`
				<span class="ib-oc-legend-item ${is_active ? "ib-oc-legend-item--active" : ""}"
				      data-dept="${frappe.utils.escape_html(dept)}"
				      style="${is_active ? `border-color:${color};background:${color}18` : ""}">
					<span class="ib-oc-legend-dot" style="background:${color}"></span>
					<span class="ib-oc-legend-dept-name">${frappe.utils.escape_html(_clean_dept(dept))}</span>
					<span class="ib-oc-legend-count" style="${is_active ? `color:${color}` : ""}">${counts[dept] || 0}</span>
				</span>
			`);
		});

		$legend.find(".ib-oc-legend-item").on("click", (e) => {
			const dept = $(e.currentTarget).data("dept");
			this._dept_highlight = this._dept_highlight === dept ? null : dept;
			this._apply_dept_highlight();
			this._build_legend();
		});

		// Show/hide clear button
		const clear_btn = document.getElementById("ib-oc-legend-clear");
		if (clear_btn) clear_btn.style.display = active ? "inline-block" : "none";
	}

	_apply_dept_highlight() {
		const d3 = window.d3;
		const q = this._dept_highlight;
		d3.selectAll(".ib-oc-node").each(function (d) {
			if (d.data.type !== "employee") return;
			const match = !q || d.data.department === q;
			d3.select(this).select(".ib-oc-card")
				.classed("ib-oc-card--dim", !match)
				.classed("ib-oc-card--match", !!match && !!q);
		});
	}

	// ── Export PNG ────────────────────────────────────────────────────────────

	_export_png() {
		const svg_el = document.getElementById("ib-oc-svg");
		if (!svg_el) return;
		const clone = svg_el.cloneNode(true);
		clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		const style = document.createElement("style");
		style.textContent = this._get_inline_css();
		clone.insertBefore(style, clone.firstChild);
		const bbox = this._g?.node()?.getBBox?.() || { x: 0, y: 0, width: 1200, height: 800 };
		const pad = 60;
		clone.setAttribute("viewBox", `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
		clone.setAttribute("width", bbox.width + pad * 2);
		clone.setAttribute("height", bbox.height + pad * 2);
		clone.querySelector(".ib-oc-root-g")?.removeAttribute("transform");
		const svg_str = new XMLSerializer().serializeToString(clone);
		const blob = new Blob([svg_str], { type: "image/svg+xml" });
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			const scale = 2;
			const canvas = document.createElement("canvas");
			canvas.width = (bbox.width + pad * 2) * scale;
			canvas.height = (bbox.height + pad * 2) * scale;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.scale(scale, scale);
			ctx.drawImage(img, 0, 0);
			URL.revokeObjectURL(url);
			const a = document.createElement("a");
			a.download = `org-chart-${frappe.datetime.get_today()}.png`;
			a.href = canvas.toDataURL("image/png");
			a.click();
		};
		img.src = url;
	}

	_get_inline_css() {
		return `
			.ib-oc-card { fill: #ffffff; stroke: #eaecf0; stroke-width: 1; }
			.ib-oc-card--match { stroke: #d97757 !important; stroke-width: 2.5 !important; }
			.ib-oc-card--dim { opacity: 0.2; }
			.ib-oc-dept-card { fill: #fafbfc; stroke: #dee2e8; stroke-width: 1; stroke-dasharray: 5 3; }
			.ib-oc-link { fill: none; stroke: #c8cdd6; stroke-width: 1.5; }
			.ib-oc-initials { font: 700 12px Arial; }
			.ib-oc-emp-name { font: 700 12.5px Arial; fill: #1a1a1a; }
			.ib-oc-desig { font: 400 10.5px Arial; fill: #6c757d; }
			.ib-oc-dept-label { font: 400 10px Arial; fill: #8a929e; }
			.ib-oc-dept-name { font: 700 12px Arial; fill: #333; }
			.ib-oc-dept-count { font: 400 10px Arial; fill: #888; }
			.ib-oc-toggle-icon { font: 700 11px Arial; }
			.ib-oc-toggle-circle { stroke: #e4e8ee; stroke-width: 1; }
			.ib-oc-branch-icon { font-size: 18px; }
			.ib-oc-branch-name { font: 800 13px Arial; fill: #fff; }
			.ib-oc-branch-count { font: 400 10px Arial; fill: rgba(255,255,255,0.75); }
			.ib-oc-branch-arrow { font: 700 14px Arial; fill: rgba(255,255,255,0.85); }
			.ib-oc-badge-text { font: 600 9.5px Arial; }
		`;
	}

	// ── Dept color ────────────────────────────────────────────────────────────

	_dept_color(dept) {
		dept = dept || "Unassigned";
		if (!this._dept_color_cache[dept]) {
			let h = 0;
			for (let i = 0; i < dept.length; i++) h = (h * 31 + dept.charCodeAt(i)) & 0xffffffff;
			this._dept_color_cache[dept] = OC.DEPT_COLORS[Math.abs(h) % OC.DEPT_COLORS.length];
		}
		return this._dept_color_cache[dept];
	}

	// ── Styles ────────────────────────────────────────────────────────────────

	_inject_styles() {
		if (document.getElementById("ib-oc-styles")) return;
		const s = document.createElement("style");
		s.id = "ib-oc-styles";
		s.textContent = `
			.ib-oc-wrap {
				position: relative;
				width: 100%; height: calc(100vh - 130px);
				border-radius: 8px;
				overflow: hidden;
				border: 1px solid var(--border-color);
			}
			.ib-oc-loading {
				position: absolute; top: 50%; left: 50%;
				transform: translate(-50%, -50%);
				color: var(--text-muted); font-size: 14px;
				z-index: 10;
			}
			.ib-oc-svg {
				width: 100%; height: 100%; display: block;
			}

			/* Cards */
			.ib-oc-card {
				fill: #ffffff;
				stroke: #eaecf0;
				stroke-width: 1;
				transition: stroke 0.15s, stroke-width 0.15s, filter 0.15s;
			}
			.ib-oc-card--match { stroke: #d97757 !important; stroke-width: 2.5 !important; }
			.ib-oc-card--dim { opacity: 0.15; }
			.ib-oc-dept-card {
				fill: #fafbfc;
				stroke: #dee2e8;
				stroke-width: 1;
				stroke-dasharray: 5 3;
			}
			.ib-oc-node:hover .ib-oc-dept-card { stroke: #d97757; stroke-dasharray: none; }

			/* Links */
			.ib-oc-link { fill: none; stroke: #c8cdd6; stroke-width: 1.5; }

			/* Typography */
			.ib-oc-initials {
				font: 700 12px "Inter", sans-serif;
				pointer-events: none;
			}
			.ib-oc-emp-name {
				font: 700 12.5px "Inter", sans-serif;
				fill: #1a1a1a;
				pointer-events: none;
			}
			.ib-oc-desig {
				font: 400 10.5px "Inter", sans-serif;
				fill: #6c757d;
				pointer-events: none;
			}
			.ib-oc-dept-label {
				font: 400 10px "Inter", sans-serif;
				fill: #8a929e;
				pointer-events: none;
			}
			.ib-oc-dept-name {
				font: 700 12px "Inter", sans-serif;
				fill: #333;
				pointer-events: none;
			}
			.ib-oc-dept-count {
				font: 400 10px "Inter", sans-serif;
				fill: #888;
				pointer-events: none;
			}
			.ib-oc-toggle-icon {
				font: 700 11px "Inter", sans-serif;
				pointer-events: none;
			}
			.ib-oc-toggle-circle { stroke: #e4e8ee; stroke-width: 1; }
			.ib-oc-badge-text {
				font: 600 9.5px "Inter", sans-serif;
				pointer-events: none;
			}

			/* Branch */
			.ib-oc-branch-icon { font-size: 18px; pointer-events: none; }
			.ib-oc-branch-name { font: 800 13px "Inter", sans-serif; fill: #fff; pointer-events: none; }
			.ib-oc-branch-count { font: 400 10px "Inter", sans-serif; fill: rgba(255,255,255,0.75); pointer-events: none; }
			.ib-oc-branch-arrow { font: 700 14px "Inter", sans-serif; fill: rgba(255,255,255,0.85); pointer-events: none; }

			/* Tooltip */
			.ib-oc-tooltip {
				position: absolute;
				background: #1c2536;
				color: #e8edf3;
				border-radius: 8px;
				padding: 10px 14px;
				font-size: 12px;
				font-family: "Inter", sans-serif;
				pointer-events: none;
				z-index: 200;
				min-width: 180px;
				max-width: 240px;
				box-shadow: 0 8px 24px rgba(0,0,0,0.28);
				opacity: 0;
				transform: translateY(4px);
				transition: opacity 0.15s, transform 0.15s;
			}
			.ib-oc-tooltip--visible {
				opacity: 1;
				transform: translateY(0);
			}
			.ib-oc-tt-name {
				font-weight: 700;
				font-size: 13px;
				margin-bottom: 7px;
				color: #fff;
				border-bottom: 1px solid rgba(255,255,255,0.1);
				padding-bottom: 6px;
			}
			.ib-oc-tt-row {
				display: flex; gap: 8px; margin-top: 4px;
				color: #bcc8d8; line-height: 1.4;
			}
			.ib-oc-tt-lbl {
				color: #6d8099;
				min-width: 42px;
				flex-shrink: 0;
				font-size: 10px;
				text-transform: uppercase;
				letter-spacing: 0.03em;
				padding-top: 1px;
			}
			.ib-oc-tt-hint {
				font-size: 9.5px;
				color: #d97757;
				margin-top: 8px;
				padding-top: 6px;
				border-top: 1px solid rgba(255,255,255,0.1);
				letter-spacing: 0.02em;
			}

			/* Legend */
			.ib-oc-legend-wrap {
				position: absolute; bottom: 16px; left: 16px;
				background: rgba(255,255,255,0.94);
				border: 1px solid var(--border-color);
				border-radius: 10px;
				max-width: 260px;
				backdrop-filter: blur(8px);
				box-shadow: 0 4px 16px rgba(0,0,0,0.08);
				overflow: hidden;
			}
			.ib-oc-legend-header {
				display: flex; align-items: center; justify-content: space-between;
				padding: 8px 12px 6px;
				border-bottom: 1px solid var(--border-color);
			}
			.ib-oc-legend-title {
				font: 600 10px "Inter", sans-serif;
				text-transform: uppercase;
				letter-spacing: 0.06em;
				color: var(--text-muted);
			}
			.ib-oc-legend-clear {
				font: 600 10px "Inter", sans-serif;
				color: #d97757; background: none; border: none;
				cursor: pointer; padding: 0;
			}
			.ib-oc-legend-clear:hover { text-decoration: underline; }
			.ib-oc-legend {
				display: flex; flex-direction: column; gap: 1px;
				max-height: 260px; overflow-y: auto;
				padding: 6px 8px;
			}
			.ib-oc-legend-item {
				display: flex; align-items: center; gap: 7px;
				font-size: 11.5px; color: var(--text-color);
				font-family: "Inter", sans-serif;
				padding: 5px 6px;
				border-radius: 6px;
				cursor: pointer;
				border: 1.5px solid transparent;
				transition: background 0.15s, border-color 0.15s;
				pointer-events: all;
			}
			.ib-oc-legend-item:hover { background: rgba(0,0,0,0.04); }
			.ib-oc-legend-item--active { font-weight: 600; }
			.ib-oc-legend-dept-name { flex: 1; }
			.ib-oc-legend-count {
				font: 600 10px "Inter", sans-serif;
				color: var(--text-muted);
				background: var(--bg-color);
				border-radius: 8px;
				padding: 1px 6px;
				min-width: 20px;
				text-align: center;
			}
			.ib-oc-legend-dot {
				width: 9px; height: 9px; border-radius: 50%;
				display: inline-block; flex-shrink: 0;
			}

			/* Zoom controls */
			.ib-oc-zoom-bar {
				position: absolute; bottom: 16px; right: 16px;
				display: flex; align-items: center; gap: 2px;
				background: rgba(255,255,255,0.94);
				border: 1px solid var(--border-color);
				border-radius: 8px;
				padding: 4px 6px;
				box-shadow: 0 2px 8px rgba(0,0,0,0.08);
				backdrop-filter: blur(6px);
			}
			.ib-oc-zoom-btn {
				width: 28px; height: 28px;
				border: none; background: none;
				border-radius: 6px;
				font-size: 16px; font-weight: 600;
				color: var(--text-color);
				cursor: pointer; line-height: 1;
				display: flex; align-items: center; justify-content: center;
				transition: background 0.12s;
			}
			.ib-oc-zoom-btn:hover { background: var(--bg-color); }
			.ib-oc-zoom-fit { font-size: 13px; }
			.ib-oc-zoom-pct {
				font: 600 11px "Inter", sans-serif;
				color: var(--text-muted);
				min-width: 40px;
				text-align: center;
			}
		`;
		document.head.appendChild(s);
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _initials(name) {
	if (!name) return "?";
	return name.trim().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function _truncate(str, max) {
	if (!str) return "";
	return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function _clean_dept(dept) {
	return (dept || "Unassigned").replace(/ - IB$/i, "").replace(/ - instabiz$/i, "");
}

function _subtree_count(d) {
	const children = d.children || d._children || [];
	return children.reduce((acc, c) => {
		return acc + (c.data.type === "employee" ? 1 : 0) + _subtree_count(c);
	}, 0);
}
