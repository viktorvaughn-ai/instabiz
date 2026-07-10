frappe.pages["ib-knowledge-base"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Knowledge Base",
		single_column: true,
	});

	page.set_secondary_action("Download PDF", () => {
		window.open("/files/instabiz_knowledge_base.pdf", "_blank");
	}, "download");

	$(wrapper).find(".layout-main-section").html(_kb_html());

	if (!document.getElementById("ib-kb-drawer")) {
		document.body.insertAdjacentHTML("beforeend", _kb_drawer_html());
	}

	frappe.call({
		method: "instabiz.instabiz.page.ib_knowledge_base.ib_knowledge_base.get_kb_data",
		callback(r) {
			_setup_kb(wrapper, new Set(((r.message || {}).roles) || []));
		},
		error() {
			_setup_kb(wrapper, new Set(frappe.boot.user.roles || []));
		},
	});
};

// ── HTML shells ──────────────────────────────────────────────────────────────

function _kb_html() {
	return `
<style>
:root {
	--kb-primary: #d97757;
	--kb-primary-dark: #b85c3a;
	--kb-radius: 10px;
	--kb-transition: 200ms ease;
}

.ib-kb { font-family: var(--font-stack); color: var(--text-color); padding-bottom: 60px; }

/* Hero */
.ib-kb-hero {
	background: linear-gradient(135deg, #d97757 0%, #b85c3a 60%, #9a4a2e 100%);
	color: #fff;
	border-radius: 14px;
	padding: 28px 32px;
	margin-bottom: 22px;
	display: flex;
	align-items: center;
	gap: 20px;
}
.ib-kb-hero-icon {
	width: 52px;
	height: 52px;
	border-radius: 12px;
	background: rgba(255,255,255,.18);
	border: 1.5px solid rgba(255,255,255,.35);
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	color: #fff;
}
.ib-kb-hero h1 { font-size: 22px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.3px; }
.ib-kb-hero-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.ib-kb-hero-stat {
	background: rgba(255,255,255,.18);
	border: 1px solid rgba(255,255,255,.3);
	border-radius: 20px;
	padding: 3px 12px;
	font-size: 11.5px;
	font-weight: 600;
}
.ib-kb-hero-actions { margin-left: auto; flex-shrink: 0; }
.ib-kb-hero-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	background: rgba(255,255,255,.2);
	border: 1.5px solid rgba(255,255,255,.5);
	color: #fff;
	padding: 8px 18px;
	border-radius: 8px;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	text-decoration: none;
	transition: background var(--kb-transition);
}
.ib-kb-hero-btn:hover { background: rgba(255,255,255,.35); color: #fff; }

/* Search */
.ib-kb-search-wrap {
	position: relative;
	margin-bottom: 16px;
}
.ib-kb-search {
	width: 100%;
	padding: 13px 70px 13px 46px;
	border: 2px solid var(--border-color);
	border-radius: 12px;
	font-size: 14px;
	background: var(--card-bg);
	color: var(--text-color);
	outline: none;
	transition: border-color var(--kb-transition), box-shadow var(--kb-transition);
}
.ib-kb-search:focus {
	border-color: var(--kb-primary);
	box-shadow: 0 0 0 3px rgba(217,119,87,.12);
}
.ib-kb-search-icon {
	position: absolute;
	left: 14px;
	top: 50%;
	transform: translateY(-50%);
	color: var(--text-muted);
	display: flex;
	pointer-events: none;
}
.ib-kb-search-kbd {
	position: absolute;
	right: 14px;
	top: 50%;
	transform: translateY(-50%);
	font-size: 10px;
	font-weight: 700;
	color: var(--text-muted);
	background: var(--bg-color);
	border: 1px solid var(--border-color);
	border-radius: 5px;
	padding: 3px 7px;
	letter-spacing: .5px;
	pointer-events: none;
	transition: opacity var(--kb-transition);
}
.ib-kb-search:focus ~ .ib-kb-search-kbd { opacity: 0; }

/* Suggestions dropdown */
.ib-kb-suggestions {
	position: absolute;
	top: calc(100% + 1px);
	left: 0; right: 0;
	background: var(--card-bg);
	border: 2px solid var(--kb-primary);
	border-top: none;
	border-radius: 0 0 12px 12px;
	box-shadow: 0 10px 30px rgba(0,0,0,.12);
	z-index: 300;
	overflow: hidden;
	display: none;
	max-height: 380px;
	overflow-y: auto;
}
.ib-kb-suggestions.open { display: block; }
.ib-kb-sug-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px;
	cursor: pointer;
	border-bottom: 1px solid var(--border-color);
	transition: background var(--kb-transition);
}
.ib-kb-sug-item:last-child { border-bottom: none; }
.ib-kb-sug-item:hover, .ib-kb-sug-item.kb-focused {
	background: var(--bg-color);
}
.ib-kb-sug-icon {
	width: 32px;
	height: 32px;
	border-radius: 8px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}
.ib-kb-sug-text { flex: 1; min-width: 0; }
.ib-kb-sug-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ib-kb-sug-desc { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ib-kb-sug-section { font-size: 10px; color: var(--kb-primary); font-weight: 700; flex-shrink: 0; }
.ib-kb-sug-empty { padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
.ib-kb-sug-footer {
	padding: 8px 16px;
	background: var(--bg-color);
	font-size: 11px;
	color: var(--text-muted);
	text-align: center;
	border-top: 1px solid var(--border-color);
}

/* Autocorrect hint */
.ib-kb-correction {
	margin-bottom: 12px;
	font-size: 13px;
	color: var(--text-muted);
}
.ib-kb-correction a { color: var(--kb-primary); cursor: pointer; font-weight: 600; text-decoration: underline; }

/* Category pills */
.ib-kb-cats {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 18px;
}
.ib-kb-cat {
	padding: 5px 14px;
	border-radius: 20px;
	border: 1.5px solid var(--border-color);
	background: var(--card-bg);
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	color: var(--text-muted);
	transition: all var(--kb-transition);
	user-select: none;
}
.ib-kb-cat:hover { border-color: var(--kb-primary); color: var(--kb-primary); }
.ib-kb-cat.active {
	background: var(--kb-primary);
	border-color: var(--kb-primary);
	color: #fff;
}

/* Recently viewed */
.ib-kb-recent {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	margin-bottom: 16px;
}
.ib-kb-recent-label {
	font-size: 11px;
	color: var(--text-muted);
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: .5px;
	white-space: nowrap;
}
.ib-kb-recent-chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 3px 11px 3px 8px;
	border-radius: 16px;
	border: 1px solid var(--border-color);
	font-size: 11.5px;
	color: var(--text-color);
	cursor: pointer;
	background: var(--card-bg);
	transition: all var(--kb-transition);
	text-decoration: none;
}
.ib-kb-recent-chip:hover {
	border-color: var(--kb-primary);
	color: var(--kb-primary);
}
.ib-kb-recent-chip .rci { display: flex; align-items: center; }

/* Quick links */
.ib-kb-quick-links {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: 10px;
	margin-bottom: 22px;
}
.ib-kb-quick-link {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	padding: 12px 14px;
	text-align: center;
	cursor: pointer;
	transition: all var(--kb-transition);
	text-decoration: none;
	display: block;
}
.ib-kb-quick-link:hover {
	border-color: var(--kb-primary);
	transform: translateY(-2px);
	box-shadow: 0 6px 16px rgba(217,119,87,.14);
}
.ib-kb-quick-link .icon { width: 36px; height: 36px; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: var(--bg-color); }
.ib-kb-quick-link .label { font-size: 11.5px; font-weight: 600; color: var(--text-color); }

/* Workflow */
.ib-kb-workflow {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: var(--kb-radius);
	padding: 18px 20px;
	margin-bottom: 20px;
}
.ib-kb-workflow h3 {
	font-size: 13px;
	font-weight: 700;
	margin: 0 0 14px;
	color: var(--text-color);
	display: flex;
	align-items: center;
	gap: 8px;
}
.ib-kb-flow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.ib-kb-flow-step {
	background: var(--bg-color);
	border: 1.5px solid var(--border-color);
	padding: 7px 14px;
	border-radius: 8px;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	transition: all var(--kb-transition);
	position: relative;
}
.ib-kb-flow-step:hover {
	background: var(--kb-primary);
	color: #fff;
	border-color: var(--kb-primary);
	transform: translateY(-1px);
	box-shadow: 0 4px 10px rgba(217,119,87,.25);
}
.ib-kb-flow-step.active {
	background: var(--kb-primary-dark);
	color: #fff;
	border-color: var(--kb-primary-dark);
}
.ib-kb-flow-arrow { color: var(--kb-primary); font-size: 16px; font-weight: 700; }

/* Workflow detail */
.ib-kb-wf-detail {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: var(--kb-radius);
	overflow: hidden;
	margin-top: 14px;
	display: none;
}
.ib-kb-wf-detail.open { display: block; }
.ib-kb-wf-detail-hdr {
	background: var(--kb-primary);
	color: #fff;
	padding: 12px 18px;
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.ib-kb-wf-detail-hdr h4 { margin: 0; font-size: 14px; font-weight: 600; }
.ib-kb-wf-close { cursor: pointer; font-size: 18px; opacity: .8; line-height: 1; }
.ib-kb-wf-close:hover { opacity: 1; }
.ib-kb-wf-body { padding: 18px; }

/* Slim top bar */
.ib-kb-slimbar {
	display: flex;
	align-items: center;
	gap: 12px;
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: 10px;
	padding: 9px 14px;
	margin-bottom: 10px;
}
.ib-kb-slimbar-icon { color: var(--kb-primary); display: flex; flex-shrink: 0; }
.ib-kb-slimbar-title { font-weight: 700; font-size: 14px; white-space: nowrap; }
.ib-kb-slimbar-stat { font-size: 11px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
.ib-kb-slimbar-search { flex: 1; min-width: 140px; position: relative; margin-bottom: 0 !important; }
.ib-kb-slimbar-search .ib-kb-search {
	padding: 7px 60px 7px 34px;
	border-width: 1.5px;
	border-radius: 8px;
	font-size: 12.5px;
}
.ib-kb-slimbar-search .ib-kb-search-icon { left: 11px; }
.ib-kb-slimbar-search .ib-kb-search-icon iconify-icon { width: 14px; height: 14px; }
.ib-kb-slimbar-search .ib-kb-search-kbd { right: 10px; padding: 2px 6px; font-size: 9px; }
.ib-kb-slimbar-more {
	display: flex; align-items: center; gap: 4px;
	background: var(--bg-color); border: 1px solid var(--border-color);
	border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 600;
	color: var(--text-muted); cursor: pointer; white-space: nowrap; flex-shrink: 0;
	transition: all var(--kb-transition);
}
.ib-kb-slimbar-more:hover { color: var(--kb-primary); border-color: var(--kb-primary); }
.ib-kb-slimbar-more .chev { transition: transform .2s ease; display: inline-flex; }
.ib-kb-slimbar-more.open .chev { transform: rotate(180deg); }
.ib-kb-slimbar-pdf {
	display: flex; align-items: center; gap: 5px; flex-shrink: 0;
	background: var(--kb-primary); color: #fff; border-radius: 8px;
	padding: 7px 12px; font-size: 12px; font-weight: 600; text-decoration: none;
	transition: background var(--kb-transition);
}
.ib-kb-slimbar-pdf:hover { background: var(--kb-primary-dark); color: #fff; }

.ib-kb-more-panel {
	max-height: 0;
	overflow: hidden;
	transition: max-height .3s ease;
}
.ib-kb-more-panel.open { max-height: 900px; margin-bottom: 14px; }

/* Tabs — same pill language as .ib-kb-cat for visual consistency */
.ib-kb-tabbar {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 14px;
}
.ib-kb-tab {
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 6px 14px 6px 7px;
	border: 1.5px solid var(--border-color);
	border-radius: 20px;
	background: var(--card-bg);
	cursor: pointer;
	user-select: none;
	white-space: nowrap;
	transition: all var(--kb-transition);
	animation: kb-fadein .3s ease both;
}
.ib-kb-tab:hover { border-color: var(--kb-primary); }
.ib-kb-tab.active { background: var(--kb-primary); border-color: var(--kb-primary); }
.ib-kb-tab.active .ib-kb-tab-title { color: #fff; }
.ib-kb-tab.active .ib-kb-tab-count { background: rgba(255,255,255,.25); color: #fff; }
.ib-kb-tab.active .ib-kb-tab-icon { background: rgba(255,255,255,.25) !important; color: #fff !important; }
.ib-kb-tab-icon {
	width: 22px;
	height: 22px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}
.ib-kb-tab-title { font-weight: 700; font-size: 12.5px; color: var(--text-color); }
.ib-kb-tab-count {
	font-size: 10px;
	color: var(--text-muted);
	background: var(--bg-color);
	padding: 1px 7px;
	border-radius: 9px;
	font-weight: 600;
}

/* Content pane */
.ib-kb-pane {
	background: var(--card-bg);
	border: 1px solid var(--border-color);
	border-radius: var(--kb-radius);
	max-height: 62vh;
	overflow-y: auto;
	animation: kb-fadein .25s ease both;
}
.ib-kb-pane-search-group {
	padding: 10px 16px 4px;
	font-size: 10.5px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: .4px;
	color: var(--text-muted);
	background: var(--bg-color);
}
@keyframes kb-fadein {
	from { opacity: 0; transform: translateY(6px); }
	to   { opacity: 1; transform: translateY(0); }
}

/* Section items */
.ib-kb-item {
	display: flex;
	gap: 10px;
	padding: 10px 16px;
	cursor: pointer;
	border-bottom: 1px solid var(--border-color);
	transition: background var(--kb-transition);
}
.ib-kb-item:last-child { border-bottom: none; }
.ib-kb-item:hover { background: var(--bg-color); }
.ib-kb-item-num {
	font-size: 9.5px;
	color: var(--kb-primary);
	font-weight: 800;
	min-width: 22px;
	padding-top: 3px;
	letter-spacing: .5px;
}
.ib-kb-item-content { flex: 1; min-width: 0; }
.ib-kb-item-title { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; }
.ib-kb-item-desc {
	font-size: 11.5px;
	color: var(--text-muted);
	line-height: 1.55;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.ib-kb-item-footer {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 5px;
}
.ib-kb-item-link {
	font-size: 11px;
	color: var(--kb-primary);
	text-decoration: none;
	font-weight: 600;
	display: inline-flex;
	align-items: center;
	gap: 3px;
}
.ib-kb-item-link:hover { text-decoration: underline; color: var(--kb-primary-dark); }
.ib-kb-item-arrow {
	margin-left: auto;
	font-size: 11px;
	color: var(--text-muted);
	opacity: 0;
	transition: opacity var(--kb-transition);
}
.ib-kb-item:hover .ib-kb-item-arrow { opacity: 1; }

/* Note / Tip boxes */
.ib-kb-note {
	background: #fdf9f7;
	border-left: 3px solid var(--kb-primary);
	padding: 9px 13px;
	margin: 10px 0;
	font-size: 12px;
	border-radius: 0 6px 6px 0;
	line-height: 1.6;
}
.ib-kb-tip {
	background: #f0f9f0;
	border-left: 3px solid #1a7f37;
	padding: 9px 13px;
	margin: 10px 0;
	font-size: 12px;
	border-radius: 0 6px 6px 0;
	line-height: 1.6;
}

/* Steps list */
.ib-kb-steps {
	list-style: none;
	margin: 10px 0;
	padding: 0;
	counter-reset: kbstep;
}
.ib-kb-steps li {
	counter-increment: kbstep;
	padding: 7px 0 7px 36px;
	position: relative;
	font-size: 13px;
	border-bottom: 1px solid var(--border-color);
	line-height: 1.55;
}
.ib-kb-steps li:last-child { border-bottom: none; }
.ib-kb-steps li::before {
	content: counter(kbstep);
	position: absolute;
	left: 0;
	top: 6px;
	background: var(--kb-primary);
	color: #fff;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	text-align: center;
	font-size: 10px;
	line-height: 22px;
	font-weight: 700;
}

/* Inline doctype links */
.ib-kb-doclink {
	color: var(--kb-primary);
	font-weight: 600;
	text-decoration: none;
	border-bottom: 1px dotted rgba(217,119,87,.4);
}
.ib-kb-doclink:hover { text-decoration: underline; color: var(--kb-primary-dark); }

/* No results */
.ib-kb-no-results {
	text-align: center;
	padding: 50px 20px;
	color: var(--text-muted);
}
.ib-kb-no-results .nr-icon { width: 52px; height: 52px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; background: var(--bg-color); border-radius: 50%; color: var(--text-muted); }
.ib-kb-no-results p { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.ib-kb-no-results small { font-size: 12px; }
.ib-kb-no-results button {
	background: none;
	border: none;
	color: var(--kb-primary);
	cursor: pointer;
	font-size: 12px;
	font-weight: 600;
	text-decoration: underline;
	padding: 0;
}

/* Search highlights */
mark.ib-hl { background: #ffe082; color: inherit; padding: 0 1px; border-radius: 2px; }

/* Item title row with badges */
.ib-kb-item-title-row { display: flex; align-items: flex-start; gap: 5px; margin-bottom: 2px; }
.ib-kb-item-badges { display: flex; gap: 3px; flex-shrink: 0; align-items: center; padding-top: 1px; }
.ib-kb-badge {
	display: inline-flex; align-items: center; font-size: 9px; font-weight: 700;
	border-radius: 8px; padding: 1px 5px; white-space: nowrap; letter-spacing: .2px; line-height: 1.5;
}
.ib-kb-badge-steps { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.ib-kb-badge-note  { background: #fdf9f7; color: #b85c3a; border: 1px solid #fcd9c7; }
.ib-kb-badge-tip   { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

/* Prev / Next navigation in drawer */
.ib-kb-drawer-nav { display: flex; gap: 6px; width: 100%; }
.ib-kb-nav-btn {
	flex: 1; padding: 7px 10px; border-radius: 7px;
	border: 1.5px solid var(--border-color); background: var(--card-bg);
	color: var(--text-muted); font-size: 11px; font-weight: 600;
	cursor: pointer; transition: all 150ms; text-align: center;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.4;
}
.ib-kb-nav-btn:hover:not(:disabled) { border-color: var(--kb-primary); color: var(--kb-primary); }
.ib-kb-nav-btn:disabled { opacity: .3; cursor: not-allowed; }

/* Tab count filtered state */
.ib-kb-tab-count.ib-count-filtered { background: var(--kb-primary); color: #fff; }
</style>

<div class="ib-kb">

<!-- Slim top bar -->
<div class="ib-kb-slimbar">
  <span class="ib-kb-slimbar-icon"><iconify-icon icon="lucide:book-open" width="20" height="20"></iconify-icon></span>
  <span class="ib-kb-slimbar-title">Knowledge Base</span>
  <span class="ib-kb-slimbar-stat" id="ib-kb-stat-articles">Loading...</span>
  <div class="ib-kb-search-wrap ib-kb-slimbar-search" id="ib-kb-search-wrap">
    <span class="ib-kb-search-icon"><iconify-icon icon="lucide:search" width="16" height="16"></iconify-icon></span>
    <input type="text" class="ib-kb-search" id="ib-kb-search"
      placeholder="Search articles, workflows, features..."
      autocomplete="off" spellcheck="false" aria-label="Search knowledge base">
    <span class="ib-kb-search-kbd">Ctrl K</span>
    <div class="ib-kb-suggestions" id="ib-kb-suggestions" role="listbox"></div>
  </div>
  <div class="ib-kb-slimbar-more" id="ib-kb-more-toggle">
    <span>More</span><iconify-icon class="chev" icon="lucide:chevron-down" width="13" height="13"></iconify-icon>
  </div>
  <a href="/files/instabiz_knowledge_base.pdf" target="_blank" class="ib-kb-slimbar-pdf">
    <iconify-icon icon="lucide:download" width="13" height="13"></iconify-icon> PDF
  </a>
</div>

<!-- Autocorrect hint -->
<div class="ib-kb-correction" id="ib-kb-correction"></div>

<!-- Collapsible extras: categories, recent, quick links, workflow stepper -->
<div class="ib-kb-more-panel" id="ib-kb-more-panel">

  <!-- Category pills -->
  <div class="ib-kb-cats" id="ib-kb-cats"></div>

  <!-- Recently viewed -->
  <div class="ib-kb-recent" id="ib-kb-recent">
    <span class="ib-kb-recent-label">Recent</span>
    <div id="ib-kb-recent-chips"></div>
  </div>

  <!-- Quick links -->
  <div class="ib-kb-quick-links" id="ib-kb-quick-links">
    <a href="/app/ib-customer-board"     class="ib-kb-quick-link"><span class="icon" style="color:#1a7f37"><iconify-icon icon="lucide:target" width="20" height="20"></iconify-icon></span><span class="label">Customer Board</span></a>
    <a href="/app/ib-stock-dashboard"    class="ib-kb-quick-link"><span class="icon" style="color:#6b21a8"><iconify-icon icon="lucide:package" width="20" height="20"></iconify-icon></span><span class="label">Stock Dashboard</span></a>
    <a href="/app/quotation/new-quotation-1" class="ib-kb-quick-link"><span class="icon" style="color:#b85c3a"><iconify-icon icon="lucide:file-text" width="20" height="20"></iconify-icon></span><span class="label">New Quotation</span></a>
    <a href="/app/sales-order"           class="ib-kb-quick-link"><span class="icon" style="color:#b85c3a"><iconify-icon icon="lucide:shopping-cart" width="20" height="20"></iconify-icon></span><span class="label">Sales Orders</span></a>
    <a href="/app/ib-ai-inbox"           class="ib-kb-quick-link"><span class="icon" style="color:#7c3aed"><iconify-icon icon="lucide:bot" width="20" height="20"></iconify-icon></span><span class="label">AI Inbox</span></a>
    <a href="/app/ib-main-dashboard"     class="ib-kb-quick-link"><span class="icon" style="color:#006064"><iconify-icon icon="lucide:layout-dashboard" width="20" height="20"></iconify-icon></span><span class="label">Dashboard</span></a>
    <a href="/app/ib-price-list"         class="ib-kb-quick-link"><span class="icon" style="color:#b8860b"><iconify-icon icon="lucide:tag" width="20" height="20"></iconify-icon></span><span class="label">Rate Card</span></a>
    <a href="/app/query-report/IB Daily Sales Report" class="ib-kb-quick-link"><span class="icon" style="color:#1a60b0"><iconify-icon icon="lucide:trending-up" width="20" height="20"></iconify-icon></span><span class="label">Daily Sales</span></a>
  </div>

  <!-- Workflow stepper -->
  <div class="ib-kb-workflow">
    <h3 style="display:flex;align-items:center;gap:8px"><iconify-icon icon="lucide:git-branch" width="15" height="15" style="color:var(--kb-primary)"></iconify-icon>Sales Workflow <small style="font-weight:400;font-size:11px;color:rgba(0,0,0,.5)"> — click a step to learn more</small></h3>
    <div class="ib-kb-flow">
      <div class="ib-kb-flow-step" data-workflow="lead">Lead / Customer</div>
      <div class="ib-kb-flow-arrow">&#8594;</div>
      <div class="ib-kb-flow-step" data-workflow="quotation">Quotation</div>
      <div class="ib-kb-flow-arrow">&#8594;</div>
      <div class="ib-kb-flow-step" data-workflow="so">Sales Order</div>
      <div class="ib-kb-flow-arrow">&#8594;</div>
      <div class="ib-kb-flow-step" data-workflow="dn">Delivery Note</div>
      <div class="ib-kb-flow-arrow">&#8594;</div>
      <div class="ib-kb-flow-step" data-workflow="si">Sales Invoice</div>
      <div class="ib-kb-flow-arrow">&#8594;</div>
      <div class="ib-kb-flow-step" data-workflow="payment">Payment</div>
    </div>
    <div class="ib-kb-wf-detail" id="ib-kb-wf-detail">
      <div class="ib-kb-wf-detail-hdr">
        <h4 id="ib-kb-wf-title">Detail</h4>
        <span class="ib-kb-wf-close" id="ib-kb-wf-close">&#x2715;</span>
      </div>
      <div class="ib-kb-wf-body" id="ib-kb-wf-body"></div>
    </div>
  </div>

</div>

<!-- No results -->
<div class="ib-kb-no-results" id="ib-kb-no-results" style="display:none">
  <span class="nr-icon"><iconify-icon icon="lucide:search-x" width="26" height="26"></iconify-icon></span>
  <p id="ib-kb-no-q">No results found</p>
  <small>Try different keywords or <button id="ib-kb-clear-search">clear search</button></small>
</div>

<!-- Section tabs + content pane -->
<div class="ib-kb-tabbar" id="ib-kb-tabbar"></div>
<div class="ib-kb-pane" id="ib-kb-pane"></div>

</div>`;
}

function _kb_drawer_html() {
	return `
<style>
.ib-kb-overlay {
	display: none;
	position: fixed;
	inset: 0;
	background: rgba(0,0,0,.35);
	z-index: 1040;
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
}
.ib-kb-overlay.open { display: block; }

.ib-kb-drawer {
	position: fixed;
	right: 0;
	top: 0;
	width: 460px;
	max-width: 94vw;
	height: 100vh;
	background: var(--card-bg);
	border-left: 1px solid var(--border-color);
	box-shadow: -8px 0 40px rgba(0,0,0,.15);
	z-index: 1041;
	display: flex;
	flex-direction: column;
	transform: translateX(100%);
	transition: transform .28s cubic-bezier(.4,0,.2,1);
}
.ib-kb-drawer.open { transform: translateX(0); }

.ib-kb-drawer-hdr {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 14px 18px;
	border-bottom: 1px solid var(--border-color);
	background: var(--bg-color);
	flex-shrink: 0;
}
.ib-kb-drawer-bc {
	flex: 1;
	font-size: 12px;
	color: var(--text-muted);
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
}
.ib-kb-drawer-bc .bc-section { font-weight: 700; }
.ib-kb-drawer-bc .bc-arrow { opacity: .5; }
.ib-kb-drawer-bc-icon { display: flex; align-items: center; }
.ib-kb-drawer-close {
	width: 28px;
	height: 28px;
	border-radius: 50%;
	border: 1px solid var(--border-color);
	background: var(--card-bg);
	cursor: pointer;
	font-size: 14px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	transition: all 200ms ease;
	color: var(--text-color);
}
.ib-kb-drawer-close:hover { background: #fee2d5; border-color: var(--kb-primary); color: var(--kb-primary); }

.ib-kb-drawer-body {
	flex: 1;
	overflow-y: auto;
	padding: 20px 22px;
}
.ib-kb-drawer-body h2 {
	font-size: 17px;
	font-weight: 700;
	margin: 0 0 10px;
	line-height: 1.35;
}
.ib-kb-drawer-body p.desc {
	font-size: 13px;
	color: var(--text-muted);
	line-height: 1.65;
	margin-bottom: 16px;
}

.ib-kb-drawer-footer {
	padding: 14px 22px;
	border-top: 1px solid var(--border-color);
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
	flex-shrink: 0;
	background: var(--bg-color);
}
.ib-kb-drawer-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 8px 16px;
	border-radius: 8px;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	text-decoration: none;
	transition: all 200ms ease;
	border: 1.5px solid;
}
.ib-kb-drawer-btn.primary {
	background: var(--kb-primary);
	border-color: var(--kb-primary);
	color: #fff;
}
.ib-kb-drawer-btn.primary:hover {
	background: var(--kb-primary-dark);
	border-color: var(--kb-primary-dark);
	color: #fff;
}
.ib-kb-drawer-btn.secondary {
	background: var(--card-bg);
	border-color: var(--border-color);
	color: var(--text-color);
}
.ib-kb-drawer-btn.secondary:hover {
	border-color: var(--kb-primary);
	color: var(--kb-primary);
}

/* Related items strip */
.ib-kb-related { margin-top: 22px; }
.ib-kb-related-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 8px; }
.ib-kb-related-item {
	display: flex;
	gap: 8px;
	align-items: center;
	padding: 8px 0;
	border-bottom: 1px solid var(--border-color);
	cursor: pointer;
	transition: color 150ms;
}
.ib-kb-related-item:last-child { border-bottom: none; }
.ib-kb-related-item:hover .ri-title { color: var(--kb-primary); }
.ri-title { font-size: 12.5px; font-weight: 600; flex: 1; }
.ri-arrow { font-size: 11px; color: var(--text-muted); }
</style>
<div class="ib-kb-overlay" id="ib-kb-overlay"></div>
<aside class="ib-kb-drawer" id="ib-kb-drawer" role="dialog" aria-modal="true">
  <div class="ib-kb-drawer-hdr">
    <div class="ib-kb-drawer-bc" id="ib-kb-drawer-bc"></div>
    <button class="ib-kb-drawer-close" id="ib-kb-drawer-close" aria-label="Close">&#x2715;</button>
  </div>
  <div class="ib-kb-drawer-body" id="ib-kb-drawer-body"></div>
  <div class="ib-kb-drawer-footer" id="ib-kb-drawer-footer"></div>
</aside>`;
}

// ── KB Data ──────────────────────────────────────────────────────────────────

const _ALL  = ["System Manager","Sales Manager","Sales User","Accounts Manager","Accounts User","HR Manager","HR User","Purchase Manager","Purchase User","Warehouse Manager","Stock User","Factory Management"];
const _SALES    = ["System Manager","Sales Manager","Sales User"];
const _FINANCE  = ["System Manager","Accounts Manager","Accounts User","Sales Manager"];
const _MANAGERS = ["System Manager","Sales Manager","Accounts Manager","HR Manager","Purchase Manager"];
const _HR       = ["System Manager","HR Manager","HR User"];
const _PURCHASE = ["System Manager","Purchase Manager","Purchase User"];
const _STOCK    = ["System Manager","Warehouse Manager","Stock User","Purchase Manager","Purchase User","Sales Manager","Factory Management"];
const _PROD     = ["System Manager","Factory Management","Sales Manager"];
const _AI       = ["System Manager","Sales Manager","Accounts Manager"];
const _ANALYTICS= ["System Manager","Sales Manager","Accounts Manager","HR Manager","Purchase Manager"];

const KB_SECTIONS = [
	{
		id: "access", cat: "access",
		icon: '<iconify-icon icon="lucide:shield-check" width="17" height="17"></iconify-icon>', color: "#f0f4ff", iconColor: "#3b5bdb",
		title: "Workspace Roles & Access",
		roles: _ALL,
		items: [
			{
				num: "ACC-1", title: "Who Sees What — Workspace Shortcuts by Role",
				desc: "Each Instabiz workspace shortcut is filtered by role. You only see shortcuts your role allows.<br><br><b>Sales User</b> (operational CRM): Customer Board, Leads Pipeline, Sales Incentives, Quotation, Sales Order, Customer Master, IB Rate Card, Lead, Sales Invoice, Sample Request, Delivery Note, Live Stock Balance, Stock Ledger, Main Dashboard, Knowledge Base.<br><br><b>Sales Manager</b> (all of Sales User + management tools): Business Pulse, Analytics Hub, Customer Health, Assignment Admin, WA Broadcast. Plus all Sales Reports: Daily Sales, Sales KPIs, Sales Person, Lost Deals, Territory, SKU Sales, Gross Margin, Collections, Credit Notes, Debit Notes, Activity Log, Stock Ageing, Dispatch Report.<br><br><b>Accounts User / Accounts Manager</b>: Finance Dashboard, Procurement Dashboard, Bank Import, Purchase Invoice, Payment Entry, PDC Cheques, Purchase Order, Purchase Receipt, Credit Note, Debit Note, Collections Page. Finance Reports: AR Aging, AP Aging, Cash Flow, Bank Recon, Purchase Pipeline.<br><br><b>HR Manager</b>: HR Dashboard, Employees, Attendance Terminal, Org Chart, Leave Applications, Salary Slips, Overtime Requests, F&amp;F Settlement. HR Reports: Payroll Summary.<br><br><b>Factory Management</b>: Production Dashboard, Production Stages, DPR Report, Work Orders, Machines, Order Sheets. Production Reports: Production Report.<br><br><b>System Manager</b>: AI Inbox, AI Actions, Agent Logs, n8n Console. Plus everything else.<br><br><b>Knowledge Base</b>: visible to all roles.",
				tags: "roles access workspace shortcuts who sees what sales manager user accounts hr factory production",
			},
			{
				num: "ACC-2", title: "Document-Level Permissions (Sales Docs)",
				desc: "Within Sales documents (Quotation, Sales Order, Delivery Note, Sales Invoice), data visibility is further filtered:<br><br><b>Sales User</b> — sees only documents they own or are assigned to (custom_sales_person_user = their email).<br><b>Sales Manager, System Manager</b> — sees all documents across all reps (privileged bypass).<br><br>This applies to List views and reports. Creating a new document auto-assigns it to the logged-in user.",
				tags: "document permission sales user manager visibility isolation data access",
			},
			{
				num: "ACC-3", title: "Role Reference — Who Can Do What",
				desc: "<b>Sales User:</b> Create and manage own Quotations, Sales Orders, Leads, Delivery Notes, Sales Invoices, Sample Requests. View Rate Card and Stock.<br><b>Sales Manager:</b> All of Sales User + view all reps' documents + Reports + Assignment Admin + WA Broadcast + set Sales Targets.<br><b>Accounts User:</b> Finance shortcuts + Finance Reports. Create Payment Entries, Purchase Invoices, PDC records. Bank Import and Reconciliation.<br><b>Accounts Manager:</b> All of Accounts User + full Finance access.<br><b>HR Manager:</b> Employees, Attendance, Leave, Payroll, Overtime, F&amp;F Settlement. Approve/reject leave applications inline from HR Dashboard.<br><b>Factory Management:</b> Work Orders, Machines, Order Sheets, Production Dashboard, DPR, Production Stages.<br><b>System Manager:</b> Full access including AI Inbox/Actions, n8n Console, workspace management, user administration.",
				tags: "role reference what can do sales accounts hr factory system manager permissions",
			},
		],
	},
	{
		id: "sales", cat: "sales",
		icon: '<iconify-icon icon="lucide:shopping-cart" width="17" height="17"></iconify-icon>', color: "#fde8e0", iconColor: "#b85c3a",
		title: "Sales and Quotations",
		roles: _SALES,
		items: [
			{
				num: "2.2", title: "Creating a Quotation",
				desc: "Go to Workspace, Quotation, New. Set Location, Customer or Lead, add items with dimensions. System auto-calculates qty and picks the GST template.",
				link: "/app/quotation/new-quotation-1", linkLabel: "New Quotation",
				tags: "q quote estimate pricing",
				steps: [
					"Go to <b>Workspace, Quotation, New</b>.",
					"Set <b>Location</b> (Maharashtra / Gujarat / Chennai) — auto-sets GSTIN and naming prefix.",
					"Select <b>Quotation To</b>: Customer or Lead.",
					"Add items: enter Width (mm), Length (mtr), Qty/Pkg, Total Pkg. Qty auto-calculates.",
					"Rate auto-applies from Pricing Rules if a rate contract is configured.",
					"System picks GST template (In-state / Out-state) from GSTINs automatically.",
					"Floor price check: if rate is below cost + min margin, Sales User is blocked.",
					"Save as Draft, then Submit.",
				],
				tip: "Quotations expire after 1 month. Daily scheduler sends alerts at 15, 7, and 1 day before expiry.",
			},
			{
				num: "2.3", title: "Converting Quotation to Sales Order",
				desc: "Open a submitted Quotation, click Make, Sales Order. Dimensions, transport, and address carry across automatically.",
				link: "/app/quotation", linkLabel: "Quotation List",
				tags: "so convert confirm order",
				steps: [
					"Open a submitted Quotation.",
					"Click <b>Make, Sales Order</b>.",
					"Review — all item dimensions and custom fields are pre-filled.",
					"Submit. Stock is reserved at this point.",
				],
				note: "SO submit is blocked if customer outstanding exceeds the credit limit AND the oldest invoice is past the configured overdue days.",
			},
			{
				num: "2.4", title: "Creating a Delivery Note",
				desc: "From submitted Sales Order, click Make, Delivery Note. Warehouse auto-sets from location. System checks stock and creates a draft Stock Reconciliation if short.",
				link: "/app/delivery-note", linkLabel: "Delivery Notes",
				tags: "dn dispatch ship goods",
				steps: [
					"Open the submitted Sales Order.",
					"Click <b>Make, Delivery Note</b>.",
					"Enter <b>LR Number</b> and <b>Transporter</b>.",
					"If stock is short, a draft Stock Reconciliation is auto-created — submit it first, then re-submit DN.",
					"On DN submit: E-Way Bill auto-generates; sales person gets a bell notification.",
				],
			},
			{
				num: "2.5", title: "Creating a Sales Invoice",
				desc: "From submitted Delivery Note, click Make, Sales Invoice. Inherits the same number (DN IB-BWD-DC-00005 becomes SI IB-BWD-INV-00005). Add transport charges if applicable.",
				link: "/app/sales-invoice", linkLabel: "Sales Invoices",
				tags: "si invoice billing irn einvoice",
				steps: [
					"Open the submitted Delivery Note.",
					"Click <b>Make, Sales Invoice</b>.",
					"Optionally enter <b>Transport Charges</b> — GST on transport is auto-calculated.",
					"Submit. Click <b>Generate e-Invoice</b> button to create the IRN after submission.",
					"Print using <b>IB Tax Invoice</b> format for the 2-page output with IRN / QR code.",
				],
			},
			{
				num: "2.7", title: "Editing Items on a Submitted Quotation",
				desc: "Dimension fields, rates, quantities, and amounts can all be changed directly on a submitted Quotation without amending. Item code, location, or adding/removing rows require amendment.",
				tags: "edit submitted quotation item amend change update rate qty",
				steps: [
					"Open the submitted Quotation.",
					"<b>Fields editable directly (no amendment needed):</b> Width (mm), Length (mtr), QTY/PKG, Total PKG, Branding, Marking, Thickness, Color, HSN/SAC, Rate, Qty, Amount. All have <code>allow_on_submit=1</code>.",
					"Use <b>Update Items</b> button or click the field directly in the items table.",
					"Simply click the field, edit, and save.",
					"<b>Fields requiring amendment:</b> Item Code, Quotation To (Customer/Lead), Location, or adding/removing items.",
					"To amend: click <b>Cancel</b> (you must enter a Cancellation Reason), then click <b>Amend</b>.",
					"Amendment creates a new version: <code>IB-BWD-Q-00005-1</code>. The original is locked.",
					"Edit the new amended draft, then re-submit.",
				],
				note: "Transport field on the Quotation header is also directly editable on submitted docs.",
			},
			{
				num: "2.75", title: "Amending a Submitted Sales Order",
				desc: "To change item quantities, rates, or items on a submitted SO: Cancel → Amend. A few fields (Transport, Cancellation Reason, Advance Received) are editable without amendment.",
				tags: "amend so sales order edit item rate qty cancel",
				steps: [
					"Open the submitted Sales Order.",
					"<b>Directly editable fields (no amendment):</b> Transport, Cancellation Reason.",
					"<b>Fields requiring amendment:</b> Item code, qty, rate, adding/removing rows.",
					"Go to SO header, enter <b>Cancellation Reason</b> in the field at the top (required before cancel).",
					"Click <b>Cancel</b>.",
					"Click the <b>Amend</b> button that appears after cancellation.",
					"A new draft SO is created with suffix: <code>IB-BWD-SO-00005-1</code>.",
					"Edit as needed, then re-submit.",
				],
				note: "If a DN or SI already exists against the SO, cancellation is blocked until those child documents are cancelled first.",
			},
			{
				num: "2.8", title: "Reopening a Cancelled Document",
				desc: "Cancelled Quotations and Sales Orders can be reopened. Blocked if a linked DN or SI still exists.",
				tags: "reopen cancel draft",
				steps: [
					"Open the cancelled document.",
					"Click <b>Reopen</b>.",
					"System resets docstatus to Draft and adds an audit comment.",
				],
			},
			{
				num: "26", title: "Margin % on Quotation Items",
				desc: "Each Quotation item shows Margin % auto-calculated: (rate - valuation_rate) / rate x 100. Read-only; updates when rate changes.",
				tags: "margin profit cost",
				note: "Valuation rate is fetched from the Item master when the item code is selected.",
			},
			{
				num: "27", title: "Floor Price Enforcement",
				desc: "If item rate is below cost plus the configured minimum margin: Sales User is blocked from saving. Sales Manager gets a warning. Configure minimum margin on the Item master via custom_min_margin_pct.",
				tags: "floor price minimum margin block",
			},
			{
				num: "SO", title: "Cancellation Reason Required",
				desc: "Sales Orders, Delivery Notes, and Sales Invoices all require a Cancellation Reason (custom_cancel_reason) before they can be cancelled.",
				tags: "cancel reason block",
			},
			{
				num: "17", title: "Rate Contracts (Customer-Specific Pricing)",
				desc: "Lock agreed rates per customer per item using ERPNext Pricing Rules. The rate auto-applies on Quotation and Sales Order when that customer is selected. No custom code needed — it is a native ERPNext feature.",
				tags: "rate contract customer pricing rule item fixed price agreement special",
				steps: [
					"Go to <b>Accounts → Pricing Rule → New</b> (or search Pricing Rule).",
					"Set <b>Applicable For</b> = Customer. Select the customer.",
					"Set <b>Apply On</b> = Item Code. Select the item.",
					"Set <b>Price or Discount</b> = Rate. Enter the agreed rate.",
					"Set <b>Valid From</b> and <b>Valid Upto</b> for the contract period.",
					"Save. Rate auto-applies whenever that customer+item combination appears on a Q or SO.",
				],
				note: "If the contract rate changes after a Quotation is submitted, the SO carries the Q's old rate. Correct the SO rate manually if needed. The Recalculate Items function reads the row rate as-is and does not overwrite it.",
			},
			{
				num: "46", title: "Packing Specification and IB Packing List",
				desc: "Each Item can have packaging fields: Rolls Per Box, Carton Weight (kg), and Carton Marking (printed on carton). These appear on the IB Packing List print format on Delivery Notes.",
				tags: "packing list rolls box carton weight marking dn print",
				steps: [
					"Open the <b>Item</b> master for a finished good.",
					"Fill in <b>Rolls Per Box</b>, <b>Carton Weight (kg)</b>, <b>Carton Marking</b> (the text to print on cartons).",
					"Save the Item.",
					"When a Delivery Note is submitted, select <b>IB Packing List</b> as the print format.",
					"Output includes: item, qty, UOM, rolls/box, number of boxes, carton weight, total weight, carton marking, LR number in header, totals row, and three signature lines.",
				],
			},
		],
	},
	{
		id: "payment", cat: "finance",
		icon: '<iconify-icon icon="lucide:credit-card" width="17" height="17"></iconify-icon>', color: "#e0f0ff", iconColor: "#1a60b0",
		title: "Payments and Collections",
		roles: _FINANCE,
		items: [
			{
				num: "3.1", title: "Recording a Payment Against Invoice",
				desc: "Open submitted Sales Invoice, click Make, Payment Entry. Set amount, payment mode, reference number, then submit.",
				link: "/app/payment-entry", linkLabel: "Payment Entries",
				tags: "pe receipt collection money bank",
				steps: [
					"Open the submitted Sales Invoice.",
					"Click <b>Make, Payment Entry</b>.",
					"Set <b>Amount Received</b>, <b>Payment Mode</b> (Bank / Cash), <b>Reference No</b>.",
					"Save and Submit.",
				],
				tip: "Accounts roles (Accounts User, Accounts Manager, System Manager) receive a bell notification on Payment Entry submit.",
			},
			{
				num: "3.3", title: "Advance Payment Against Sales Order",
				desc: "Create a Payment Entry manually with Reference DocType set to Sales Order before raising the invoice. The SO shows Advance Received (custom_advance_paid) automatically.",
				link: "/app/payment-entry", linkLabel: "New Payment Entry",
				tags: "advance prepayment so reference",
				steps: [
					"Go to <b>Accounts, Payment Entry, New</b>.",
					"Payment Type = Receive, Party Type = Customer.",
					"In Payment References table: add a row with Reference DocType = Sales Order, Reference Name = the SO number.",
					"Enter the Allocated Amount.",
					"Save and Submit.",
					"Open the Sales Order — the <b>Advance Received</b> field is now updated.",
				],
			},
			{
				num: "3.4", title: "Attaching a Payment Screenshot",
				desc: "Use Frappe attachments to upload screenshots or PDFs to any document including Sales Orders and Sales Invoices.",
				tags: "screenshot attachment photo proof",
				steps: [
					"Open the Sales Order or Sales Invoice.",
					"Click the <b>Attachments</b> section at the bottom (or the paperclip icon at top-right).",
					"Click <b>Add Attachment, Upload File</b>.",
					"Select the image or PDF from your device.",
					"Alternatively drag-and-drop the file onto the attachment area.",
				],
				tip: "Files can be attached to any document: Lead, Quotation, SO, DN, SI, Employee, etc.",
			},
			{
				num: "67", title: "Auto-Reconciliation of Payments",
				desc: "When a Payment Entry (Receive) is submitted with no reference rows, the system auto-links to the oldest outstanding Sales Invoices for that customer (FIFO order).",
				tags: "auto reconcile fifo oldest link",
				note: "Excess amount stays unallocated with an orange warning. Reconcile manually via the Frappe Bank Reconciliation Tool if needed.",
			},
			{
				num: "48", title: "Credit Limit Enforcement",
				desc: "Set in Customer, Credit Limit tab. Blocks SO submit when BOTH conditions hold: outstanding exceeds the limit AND the oldest unpaid invoice is older than the configured days.",
				link: "/app/customer", linkLabel: "Customer List",
				tags: "credit limit block outstanding overdue",
			},
			{
				num: "57", title: "Overdue Invoice Alerts (3-Tier)",
				desc: "7 days overdue: bell to sales rep. 15 days: bell to rep and managers. 30 days: bell plus customer blocked from new Sales Orders.",
				tags: "overdue alert notification bell block",
				note: "Block auto-clears when all overdue invoices are paid.",
			},
			{
				num: "60", title: "PDC (Post-Dated Cheque) Tracking",
				desc: "Use IB PDC doctype to track post-dated cheques. Alert sent 3 days before cheque date to Accounts roles and Sales Manager.",
				link: "/app/ib-pdc", linkLabel: "IB PDC List",
				tags: "pdc cheque dated bank",
			},
		],
	},
	{
		id: "returns", cat: "finance",
		icon: '<iconify-icon icon="lucide:rotate-ccw" width="17" height="17"></iconify-icon>', color: "#fce4ec", iconColor: "#880e4f",
		title: "Credit Notes and Debit Notes",
		roles: _FINANCE,
		items: [
			{
				num: "93", title: "IB Credit Note (Custom Doctype)",
				desc: "Dedicated Credit Note doctype (IB-CN-{YYYY}-{#####}) inside Instabiz. Customer-side credit for Sales Return, Rate Difference, or Post Sale Discount. Naming is independent from SI/DN series.",
				link: "/app/ib-credit-note/new-ib-credit-note-1", linkLabel: "New Credit Note",
				tags: "cn credit note return refund customer sales",
				steps: [
					"Go to <b>Finance → Credit Note</b> in the workspace.",
					"Select Company, Customer, Posting Date.",
					"Choose Reason Code: <b>Sales Return</b> / Rate Difference / Post Sale Discount.",
					"Set <b>Against Sales Invoice</b> (mandatory for Sales Return).",
					"System auto-fills items and GST template from the original SI.",
					"Adjust qty/rate as needed. GST applies automatically (CGST+SGST or IGST).",
					"Save → Submit. GL entries post: DR Income Account, DR Output GST / CR AR.",
					"For Sales Return, stock is received back (SLE created).",
				],
				note: "Naming: IB-CN-{YYYY}-{#####}. Roles: Sales User (create/draft), Sales Manager + Accounts Manager (submit/cancel). Total CNs against one SI cannot exceed SI grand total.",
			},
			{
				num: "94", title: "IB Debit Note (Custom Doctype)",
				desc: "Dedicated Debit Note doctype (IB-DBN-{YYYY}-{#####}) inside Instabiz. Supplier-side debit for Purchase Return, Rate Difference, or Post Purchase Discount.",
				link: "/app/ib-debit-note/new-ib-debit-note-1", linkLabel: "New Debit Note",
				tags: "debit note purchase vendor supplier return",
				steps: [
					"Go to <b>Finance → Debit Note</b> in the workspace.",
					"Select Company, Supplier, Posting Date.",
					"Choose Reason Code: <b>Purchase Return</b> / Rate Difference / Post Purchase Discount.",
					"Set <b>Against Purchase Invoice</b> (mandatory for Purchase Return).",
					"System auto-fills items and GST template from the original PI.",
					"Adjust qty/rate as needed. GST ITC is reversed automatically.",
					"Save → Submit. GL entries post: DR AP / CR Expense Account, CR Input ITC.",
					"For Purchase Return, stock is sent back to supplier (SLE created).",
				],
				note: "Naming: IB-DBN-{YYYY}-{#####}. Roles: Purchase User (create/draft), Purchase Manager + Accounts Manager (submit/cancel). Total DNs against one PI cannot exceed PI grand total.",
			},
			{
				num: "71", title: "Credit Note Register Report",
				desc: "Reports, IB Credit Note Register. All SI return credit notes (legacy SI-return flow) with original invoice, customer, return reason, and value.",
				link: "/app/query-report/IB Credit Note Register", linkLabel: "View Report",
				tags: "report credit note register list si return",
			},
			{
				num: "95", title: "Debit Note Register Report",
				desc: "Reports, IB Debit Note Register. All submitted IB Debit Notes with against-PI, supplier, reason code, items, GST, and grand total. Bar chart top suppliers by debit value.",
				link: "/app/query-report/IB Debit Note Register", linkLabel: "View Report",
				tags: "report debit note register list supplier purchase",
			},
		],
	},
	{
		id: "crm", cat: "crm",
		icon: '<iconify-icon icon="lucide:target" width="17" height="17"></iconify-icon>', color: "#e8f5e9", iconColor: "#1a7f37",
		title: "CRM and Lead Management",
		roles: _SALES,
		items: [
			{
				num: "5.1", title: "Creating a Lead",
				desc: "CRM, Lead, New. Enter pincode — city and district auto-fill from India Post API. Lead is auto-assigned to a sales rep via round-robin within the territory team.",
				link: "/app/lead/new-lead-1", linkLabel: "New Lead",
				tags: "lead prospect crm new create",
				steps: [
					"Go to <b>CRM, Lead, New</b>.",
					"Fill Lead Name, Mobile No, Email, Territory.",
					"Enter <b>Pincode</b> — city and district auto-fill from India Post.",
					"Save. Lead is auto-assigned to a rep via round-robin.",
				],
			},
			{
				num: "5.3", title: "Quick Status Change in Lead List",
				desc: "In the Lead List, click the coloured status pill next to a lead row to open a floating status picker. Change status without opening the full form.",
				tags: "status change quick pill list",
			},
			{
				num: "5.4", title: "Logging Activity on a Lead",
				desc: "Open Lead, click Log Activity. Select Activity Type (Call / Meeting / WhatsApp / Email / Visit), Outcome, Notes, Next Follow-Up Date.",
				tags: "log activity call meeting followup note",
				steps: [
					"Open a Lead.",
					"Click <b>Log Activity</b>.",
					"Select Activity Type: Call / Meeting / WhatsApp / Email / Visit.",
					"Select Outcome: Positive / Neutral / Negative / No Answer.",
					"Add Notes and optionally set Next Follow-Up Date.",
					"Save. Entry appears in the Lead timeline.",
				],
			},
			{
				num: "5.6", title: "Converting Lead to Customer",
				desc: "Open Lead, click Make, Customer. Custom mapper carries territory, pincode, district, city, and sales person to the new Customer automatically.",
				tags: "convert customer lead mapper territory",
				steps: [
					"Open the Lead (status: Quoted or Hot).",
					"Click <b>Make, Customer</b>.",
					"Custom mapper carries: Territory, Pincode, City, District, Sales Person.",
					"New Customer record is created and linked to this Lead.",
				],
			},
			{
				num: "18", title: "Lead Scoring (0 to 100)",
				desc: "Auto-computed daily: Temperature (0 / 30 / 60) plus Status bonus (up to 30) plus Contact completeness (mobile, email, POI, follow-up). Stored in custom_lead_score.",
				tags: "score lead hot warm cold priority",
			},
			{
				num: "22", title: "Win-Back Nudges",
				desc: "Daily scheduler: Open or Replied Quotations with no activity in 14+ days trigger an alert to the rep. Leads in Cold, Contacted, or Warm with no activity in 30+ days also trigger an alert.",
				tags: "nudge alert no activity dormant",
			},
			{
				num: "92", title: "Lead Territory Auto-Derivation",
				desc: "Territory is set automatically on Lead save. Priority: (1) GSTIN prefix — first 2 digits map to state (27=Maharashtra, 33=Tamil Nadu, 24=Gujarat). (2) Pincode — India Post API lookup if no GSTIN. To bulk-fix existing leads, run: <code>frappe.call(\"instabiz.overrides.lead.rectify_lead_territories\", {dry_run: 0})</code> from bench console.",
				tags: "territory lead gstin state pincode auto",
			},
			{
				num: "85", title: "IB Activity Log Report",
				desc: "Pulls all lead timeline activity logs (type=Info Comments). Columns: date, lead, customer, activity_type, outcome, notes, actor, next_follow_up. Filters: date range, sales person, activity type, outcome.",
				link: "/app/query-report/IB Activity Log", linkLabel: "View Report",
				tags: "activity log report lead call meeting whatsapp outcome",
			},
			{
				num: "LS-1", title: "Lead Sales Team — Round-Robin Assignment Setup",
				desc: "Lead Sales Team is a custom master that controls which sales rep gets auto-assigned to a new Lead. Each team covers one or more Territories and has a list of Members (Users). When a Lead is saved, the system matches its Territory to a team and assigns the next rep in rotation.",
				link: "/app/lead-sales-team", linkLabel: "Lead Sales Team List",
				tags: "lead sales team round robin assignment territory member user configure setup",
				steps: [
					"Go to <b>Lead Sales Team List</b> (search in top bar or Workspace, CRM).",
					"Create a new team (e.g. 'Maharashtra Sales Team').",
					"Add <b>Members</b>: each row links a User who is a sales rep.",
					"Add <b>Territories</b>: link each Territory this team covers.",
					"Save. When a Lead is created with a matching Territory, the system picks the next member in the rotation automatically.",
					"The rotation index advances per assignment — each rep gets equal turns.",
				],
				note: "If no matching team is found for a Lead's territory, the lead is left unassigned. If a member is removed from a team, the rotation resets.",
			},
			{
				num: "16", title: "IB Sample Request — Sample Dispatch Tracker",
				desc: "Track the full lifecycle of product samples from request through dispatch to feedback. Doctype: IB Sample Request (IB-SR-.YYYY.-#####). Status flow: Draft → Work Order Created → Sent → Feedback Received → Converted / Closed.",
				link: "/app/ib-sample-request", linkLabel: "Sample Request List",
				tags: "sample request dispatch feedback converted closed lifecycle free paid",
				steps: [
					"Create <b>IB Sample Request</b>: select Customer, Contact Person, Item, Qty, Sample Type (Free / Paid).",
					"System auto-sets Request Date = today, Assigned To = current user.",
					"Click <b>Mark Work Order Created</b> when production starts the sample.",
					"Click <b>Mark Sent</b> when the sample is dispatched.",
					"Click <b>Record Feedback</b>: enter Outcome (Converted / Not Interested / Follow Up / No Response) and feedback notes.",
					"Click <b>Convert to Order</b> to create a linked Sales Order.",
					"Click <b>Close</b> to close without conversion.",
				],
				note: "Status transitions are validated — cannot skip steps. Outcome and feedback are captured before closing. Related Sales Order is linked via the related_sales_order field.",
			},
		],
	},
	{
		id: "gst", cat: "gst",
		icon: '<iconify-icon icon="lucide:file-text" width="17" height="17"></iconify-icon>', color: "#fff3e0", iconColor: "#e65100",
		title: "GST, E-Invoice and E-Way Bill",
		roles: _FINANCE,
		items: [
			{
				num: "56", title: "E-Invoice (IRN) Generation",
				desc: "Generate IRN via the dedicated Generate e-Invoice button on a submitted Sales Invoice. B2C invoices (no GSTIN) are skipped. Non-blocking — check Error Log on failure.",
				tags: "irn einvoice gst b2b irn qr",
				steps: [
					"Submit the Sales Invoice.",
					"Click the <b>Generate e-Invoice</b> button at the top of the form.",
					"IRN and QR code are fetched from the NIC portal and saved to the invoice.",
					"If it fails, check <b>GST India, e-Invoice Log</b> or <b>Error Log</b> for details.",
				],
				note: "MH GSTIN is LIVE. GJ and TN GSTINs are pending NIC portal registration.",
			},
			{
				num: "29", title: "E-Way Bill Auto-Generation",
				desc: "On Delivery Note submit, E-Way Bill auto-generates if the GST API is enabled. LR number and transporter GSTIN are mapped automatically.",
				tags: "ewb ewaybill eway transport gstin dn",
				steps: [
					"Submit the Delivery Note.",
					"EWB is auto-generated if the India Compliance API is configured.",
					"For manual generation: select DN in list, Actions, Generate E-Way Bill.",
					"Extended dialog lets you choose Transaction Type and address overrides.",
				],
				tip: "Transaction Types: 1=Regular, 2=Bill To-Ship To, 3=Bill From-Dispatch From, 4=Combination.",
			},
			{
				num: "76", title: "GSTR-1 Filing",
				desc: "GST India, GSTR-1 Beta. Select Company, GSTIN, Year, Month, click Recompute. Review B2B / CDNR / HSN. Download Excel or JSON, or upload directly to the portal.",
				tags: "gstr1 filing return b2b hsn",
				steps: [
					"Go to <b>GST India, GSTR-1 Beta</b>.",
					"Select Company, GSTIN, Year, Month.",
					"Click <b>Recompute</b>.",
					"Review B2B, CDNR, and HSN summaries.",
					"Click <b>Upload to GST Portal</b> (requires API enabled).",
				],
			},
			{
				num: "77", title: "GSTR-3B Report",
				desc: "GST India, GSTR 3B Report, New. Select Company, GSTIN, Year, Month, Save. Download JSON for portal upload.",
				tags: "gstr3b return filing json",
			},
			{
				num: "78", title: "GSTR-2B Download and Match",
				desc: "GST India, Purchase Reconciliation Tool. Download GSTR-2B via API or manual JSON upload. Auto-matches against submitted Purchase Invoices.",
				tags: "gstr2b purchase reconciliation input tax credit itc",
			},
			{
				num: "70", title: "IB Tax Invoice Print Format",
				desc: "2-page print format on Sales Invoice: Page 1 = Tax Invoice with IRN and QR code, bank details, amount in words. Page 2 = E-Way Bill with EWB QR, goods, transport, vehicle details.",
				tags: "print tax invoice format irn qr eway",
			},
		],
	},
	{
		id: "reports", cat: "reports",
		icon: '<iconify-icon icon="lucide:bar-chart-2" width="17" height="17"></iconify-icon>', color: "#e0f7fa", iconColor: "#006064",
		title: "Reports and Analytics",
		roles: _ANALYTICS,
		items: [
			{
				num: "24", title: "IB Daily Sales Report",
				desc: "Single-day snapshot per rep: new leads, quotations, orders, dispatches, MTD revenue vs target. 8 summary cards including Collections Today and Order Backlog.",
				link: "/app/query-report/IB Daily Sales Report", linkLabel: "View Report",
				tags: "daily sales report rep kpi mtd target collections order backlog",
				steps: [
					"Go to <b>Reports → IB Daily Sales Report</b>.",
					"Date filter defaults to today. Change to review any past day.",
					"Click <b>Refresh</b> to load per-rep breakdown (New Leads, Q count+value, SO count+value, Dispatches, MTD Revenue, MTD Target, MTD %).",
					"Summary cards at top: Orders Today, Order Value, Dispatched Today, Collections Today (company-wide), New Leads, Order Backlog, MTD Revenue, MTD vs Target %.",
					"Bar chart shows top reps by today's order value.",
				],
				tip: "Collections Today sums all Payment Entries submitted today company-wide — useful for end-of-day finance review.",
			},
			{
				num: "23", title: "IB Sales KPIs",
				desc: "Per-rep metrics: Leads, Quotations, Orders, Lead-to-Q%, Q-to-SO%, Lead-to-SO%, Revenue, Avg Deal Size, Lost Deals. Bar chart with summary cards.",
				link: "/app/query-report/IB Sales KPIs", linkLabel: "View Report",
				tags: "kpi sales rep performance conversion lead quotation order revenue deal size lost",
				steps: [
					"Go to <b>Reports → IB Sales KPIs</b>.",
					"Set <b>from_date / to_date</b> for the period (default: current month).",
					"Optional: filter by <b>Territory</b>, <b>Sales Person</b>, or <b>Source</b>.",
					"Click Refresh. Each row = one rep. Conversion % columns color-coded: green ≥30%, orange ≥15%, red <15%.",
					"Bar chart shows top-10 reps by revenue. Summary cards show aggregate totals.",
				],
			},
			{
				num: "64", title: "IB Gross Margin",
				desc: "Per-item: qty sold, revenue, COGS (from Item valuation rate), gross profit, margin %. Color-coded: green at 30%+, orange at 15%+, red below 15%.",
				link: "/app/query-report/IB Gross Margin", linkLabel: "View Report",
				tags: "margin profit cogs item revenue gross profit valuation rate color coded",
				steps: [
					"Go to <b>Reports → IB Gross Margin</b>.",
					"Set date range. Filter by territory, item group, or sales person if needed.",
					"Refresh. COGS = <code>qty_sold × Item.valuation_rate</code> (Item master rate, not SI valuation_rate).",
					"Margin % column: green ≥30%, orange ≥15%, red <15% — identifies unprofitable SKUs.",
					"Bar chart shows Revenue vs Gross Profit for top 10 items.",
				],
				note: "Margin uses Item master valuation_rate, not the landed cost on each invoice. Update Item valuation_rate if average cost changes.",
			},
			{
				num: "58", title: "IB AR Aging",
				desc: "Outstanding Sales Invoices bucketed into 0-30, 31-60, 61-90, 90+ days. Color-coded for old invoices. Filter by customer, territory, sales person.",
				link: "/app/query-report/IB AR Aging", linkLabel: "View Report",
				tags: "ar aging outstanding overdue receivable bucket 90 days customer",
				steps: [
					"Go to <b>Reports → IB AR Aging</b>.",
					"Filter by customer, territory, or sales person as needed.",
					"Click Refresh. Each row = one Sales Invoice. Age column = days since posting date.",
					"90+ bucket colored red. Summary cards: total count, unique customers, total outstanding, 90+ amount.",
					"Use this to prioritize collection calls — sort by 90+ bucket descending.",
				],
			},
			{
				num: "69", title: "IB Collections Report",
				desc: "Per-rep: invoiced, collected, outstanding, collection %. 3-dataset bar chart (Invoiced / Collected / Outstanding). Filter by date, territory, sales person.",
				link: "/app/query-report/IB Collections Report", linkLabel: "View Report",
				tags: "collections report rep invoiced outstanding collection percent bar chart",
				steps: [
					"Go to <b>Reports → IB Collections Report</b>.",
					"Set date range (defaults: month start → today). Filter by territory, sales person, or chart type.",
					"Refresh. Per-rep row: invoice count, invoiced ₹, collected ₹ (grand_total − outstanding), outstanding ₹, collection % (green ≥75%, orange ≥40%, red <40%).",
					"3-dataset bar chart: Invoiced / Collected / Outstanding per rep.",
					"Summary cards: Total Invoiced, Collected, Outstanding, Overall Collection %.",
				],
			},
			{
				num: "80", title: "IB Cash Flow Statement",
				desc: "GL-entry based: inflows and outflows by category (Collections, Vendor Payments, Salaries, Operating, Tax). Running balance column.",
				link: "/app/query-report/IB Cash Flow Statement", linkLabel: "View Report",
				tags: "cash flow statement inflow outflow balance gl entry bank hdfc payment salary operating tax",
				steps: [
					"Go to <b>Reports → IB Cash Flow Statement</b>.",
					"Filter: bank_account (blank = all 3 HDFC accounts), from_date, to_date, chart_type.",
					"Refresh. Each row = one GL entry on a bank account. Inflow green, outflow red. Running balance column.",
					"Categories auto-derived: Customer collections, Vendor payments, Salary & Wages, Operating Expenses, Financing, Tax Payments, Inter-account.",
					"Summary cards: Opening Balance, Total Inflows, Total Outflows, Net Cash Flow, Closing Balance.",
				],
			},
			{
				num: "86", title: "IB Purchase Pipeline Report",
				desc: "Submitted Purchase Orders with linkage to GRN (receipt) and Purchase Invoice status. See which POs are pending receipt or billing. Filters: date range.",
				link: "/app/query-report/IB Purchase Pipeline", linkLabel: "View Report",
				tags: "purchase pipeline po grn pi receipt billing pending supplier overdue",
				steps: [
					"Go to <b>Reports → IB Purchase Pipeline</b>.",
					"Set from_date and to_date to scope to a PO period.",
					"Refresh. Each row = one submitted PO with its GRN status and PI status.",
					"Use this to find POs with no GRN (not yet received) or GRN-done but PI not raised.",
					"Cross-reference with PO Follow-Up Alerts (feature #30) — those also flag POs >7 days with no GRN.",
				],
			},
			{
				num: "TIP", title: "Changing Report Chart Type",
				desc: "All custom reports have a Chart Type filter: Bar / Pie / Donut / Line / Percentage. Change it and re-run to switch the chart style.",
				tags: "chart bar pie donut line report filter chart type",
				steps: [
					"Open any IB custom report.",
					"Find the <b>Chart Type</b> filter (dropdown, default Bar).",
					"Select Bar / Pie / Donut / Line / Percentage.",
					"Click <b>Refresh</b> to redraw the chart in the new style.",
				],
			},
			{
				num: "62", title: "IB Territory Report",
				desc: "Per-territory breakdown: leads, quotations, orders, revenue, avg deal size, lead-to-SO conversion % (color-coded green ≥30% / orange ≥15% / red <15%), lost leads. Bar chart with Revenue and Orders datasets. Filters: from_date, to_date.",
				link: "/app/query-report/IB Territory Report", linkLabel: "View Report",
				tags: "territory report leads orders revenue conversion rate lost deals geographic performance",
				steps: [
					"Go to <b>Reports → IB Territory Report</b>.",
					"Set date range. Refresh.",
					"Each row = one territory. Conversion % = Lead-to-SO %; green ≥30%, orange ≥15%, red <15%.",
					"Bar chart shows Revenue and Orders per territory.",
					"Use this to identify under-performing territories or allocate more reps.",
				],
			},
			{
				num: "63", title: "IB SKU Report",
				desc: "Per-item: item code, item name, item group, UOM, orders count, qty sold, revenue, avg rate, number of unique customers. Bar chart top 10 by revenue. Filters: from_date, to_date, territory, item group.",
				link: "/app/query-report/IB SKU Report", linkLabel: "View Report",
				tags: "sku item report revenue qty sold customers top items product group territory",
				steps: [
					"Go to <b>Reports → IB SKU Report</b>.",
					"Set date range. Optionally filter by territory or item group.",
					"Refresh. Per-item row: orders count, qty sold, revenue, avg rate, unique customers.",
					"Bar chart shows top 10 SKUs by revenue.",
					"Use this to identify fast-movers vs slow-movers; cross-reference with IB Gross Margin for profitability.",
				],
			},
			{
				num: "25", title: "IB Lost Deal Analysis",
				desc: "Lost Leads (custom_status=Lost) and lost Quotations (status=Lost) in one report. Columns: source, loss reason, sales person, territory, month, count, value lost, doc link. Bar chart by loss reason. Filters: date range, source, loss reason, territory, sales person.",
				link: "/app/query-report/IB Lost Deal Analysis", linkLabel: "View Report",
				tags: "lost deal analysis report lead quotation loss reason source why churn competitor price",
				steps: [
					"Go to <b>Reports → IB Lost Deal Analysis</b>.",
					"Set date range. Filter by source, loss_reason, territory, or sales_person as needed.",
					"Refresh. Each row = one lost Lead or lost Quotation. Click the doc link to open the original.",
					"Bar chart shows loss count by reason (Price / Competitor / No Budget / Product / etc.).",
					"Use loss reason trends to guide product or pricing decisions.",
				],
			},
			{
				num: "54", title: "IB Dispatch Report",
				desc: "Per-Delivery-Note for a date: customer, location (derived from warehouse), transporter, LR number, items summary, qty, value, sales person. Bar chart by transporter. Summary: dispatch count, total qty, total value, transporter count. Filters: date, warehouse, sales person.",
				link: "/app/query-report/IB Dispatch Report", linkLabel: "View Report",
				tags: "dispatch report dn delivery note transporter lr number location qty date daily",
				steps: [
					"Go to <b>Reports → IB Dispatch Report</b>.",
					"Set <b>date</b> (default today). Filter by warehouse or sales person if needed.",
					"Refresh. Each row = one Delivery Note. Location derived from set_warehouse (MH/GJ/CN).",
					"Summary: total dispatch count, total qty, total value, unique transporters.",
					"Bar chart shows dispatch qty by transporter.",
				],
			},
			{
				num: "73", title: "IB Sales Person Summary",
				desc: "Per-rep summary from submitted SOs: order count, total revenue, avg order value, max order value. Sales person name resolved from custom_sales_person → User full_name. Filters: from_date, to_date, sales_person_user, status, territory.",
				link: "/app/query-report/IB Sales Person Summary", linkLabel: "View Report",
				tags: "sales person summary rep revenue orders performance avg max order value",
				steps: [
					"Go to <b>Reports → IB Sales Person Summary</b>.",
					"Set date range. Filter by sales_person_user, status, or territory.",
					"Refresh. Each row = one rep: order count, total revenue, avg order value, max order value.",
					"Use alongside IB Sales KPIs for a complete rep performance picture.",
				],
			},
			{
				num: "72", title: "IB Payroll Summary",
				desc: "Per-employee payroll breakdown using the active salary structure. Computes Basic, HRA, CA, Gross, PF, ESIC, PT, Net — mirroring IB Payroll and Astro Payroll formulas. Supports payroll month filter with proration for absent days. Filters: payroll_month, emp_category (All / Factory / Office), salary_structure.",
				link: "/app/query-report/IB Payroll Summary", linkLabel: "View Report",
				tags: "payroll summary report employee salary basic hra pf esic net factory office prorate absent",
				steps: [
					"Go to <b>Reports → IB Payroll Summary</b>.",
					"Set <b>payroll_month</b> (first of the month). Filter emp_category: All / Factory / Office. Select salary_structure if needed.",
					"Refresh. Per-employee row: Basic, HRA, CA, Gross, PF, ESIC, PT, Net (all computed from structure formulas).",
					"If payroll_month set: amounts prorated by present_days / days_in_month (IB Payroll gives 2-day leave credit).",
					"Use this for payroll review before processing salary slips in HRMS.",
				],
				note: "Factory = department name containing 'Factory'. Absent days: submitted Salary Slips first, then Attendance records.",
			},
		],
	},
	{
		id: "stock", cat: "stock",
		icon: '<iconify-icon icon="lucide:package" width="17" height="17"></iconify-icon>', color: "#f3e8ff", iconColor: "#6b21a8",
		title: "Stock and Inventory",
		roles: _STOCK,
		items: [
			{
				num: "9", title: "Live Stock Dashboard",
				desc: "Workspace, Live Stock Balance. Real-time stock across 3 warehouses with multi-token search, color dots, breakdown popover, CSV export, and WebSocket live updates.",
				link: "/app/ib-stock-dashboard", linkLabel: "Open Dashboard",
				tags: "stock live dashboard warehouse balance qty",
			},
			{
				num: "53", title: "Stock Ageing Report",
				desc: "Reports, IB Stock Ageing. Per-item and warehouse: qty, first receipt date, age in days, buckets 0-30 / 31-60 / 61-90 / 90+, valuation rate, stock value.",
				link: "/app/query-report/IB Stock Ageing", linkLabel: "View Report",
				tags: "ageing stock age old report",
			},
			{
				num: "34", title: "Batch Tracking Auto-Set",
				desc: "Items in groups BOPP, CLOTH, FOAM, SPECIALTY automatically have Batch Tracking enabled. Select the batch on Delivery Notes and Stock Entries.",
				tags: "batch tracking group item",
			},
			{
				num: "28", title: "Reorder Alerts",
				desc: "Daily scheduler: when bin qty is at or below reorder level, a bell notification goes to Purchase Manager, Purchase User, and System Manager. 7-day cooldown prevents repeat alerts.",
				tags: "reorder alert low stock purchase notification",
			},
			{
				num: "36", title: "Batch Expiry Alert",
				desc: "Daily scheduler: batches expiring within 30 days trigger a bell to Warehouse Manager, Stock User, and Purchase Manager. 7-day cooldown.",
				tags: "batch expiry alert expire warehouse",
			},
			{
				num: "12", title: "IB Rate Card (Price List)",
				desc: "Page: IB Rate Card (<b>Workspace → IB Rate Card</b>). Two tabs:<br><b>Jumbo Roll</b> — Face Price and Last Price per SQMT, colour dots, spec tags, UOM chips.<br><b>Cut Pack</b> — 5 price slabs: Slab 1 (highest / small qty, blue) → Slab 2 (purple) → Slab 3 (orange) → Slab 4 (green) → Slab 5 (bulk best, teal). Face price = Slab 1, Last price = Slab 5, auto-synced on save.<br>Multi-token search with highlight across both tabs.<br><b>Access:</b> Sales User, Sales Manager, System Manager can view. Sales Manager can Add Entry (toolbar), edit any row (✏), and view full price-change history (🕐). System Manager can also delete. All edits are logged automatically.",
				link: "/app/ib-price-list", linkLabel: "Open Rate Card",
				tags: "rate card price list item pricing jumbo cut pack slab edit history add entry face last price slab1 slab2 slab3 slab4 slab5",
				steps: [
					"Go to <b>Workspace → IB Rate Card</b>.",
					"Switch tabs: <b>Jumbo Rolls</b> (FP / LP) or <b>Cut Pack</b> (Slab 1–5).",
					"Use search bar for multi-token filtering (e.g. '100 white self').",
					"Click any row to open the rate popover with all columns.",
					"<b>Sales Manager+:</b> Click <b>Add Entry</b> toolbar button to create a new entry.",
					"Click ✏ to edit an existing row.",
					"Click 🕐 to view full price-change history for that item.",
					"<b>System Manager only:</b> Click 🗑 to delete an entry.",
				],
			},
		],
	},
	{
		id: "hr", cat: "hr",
		icon: '<iconify-icon icon="lucide:users" width="17" height="17"></iconify-icon>', color: "#e8f5e9", iconColor: "#1a7f37",
		title: "HR, Attendance and Payroll",
		roles: _HR,
		items: [
			{
				num: "4", title: "Employee Self-Service Check-In",
				desc: "Employees go to /checkin. Select name, click Check-In or Out. Late or early entry triggers a reason dialog stored in Employee Checkin.",
				link: "/checkin", linkLabel: "Open Check-In Portal",
				tags: "checkin checkout attendance employee portal",
			},
			{
				num: "LA-1", title: "Applying for Leave",
				desc: "Employees submit Leave Applications via the Leave Application doctype. Leave types: Casual Leave, Sick Leave, Privilege Leave, Compensatory Off, Leave Without Pay, Maternity Leave, Paternity Leave. HR Manager or designated leave approver approves or rejects. Balance deducted on approval.",
				link: "/app/leave-application/new", linkLabel: "New Leave Application",
				tags: "leave apply application casual sick privilege maternity paternity lwp compensatory off approve reject balance hr manager",
				steps: [
					"Go to <b>Workspace → HR → Leave Application → New</b>.",
					"Select <b>Leave Type</b> (Casual Leave, Sick Leave, Privilege Leave, Compensatory Off, LWP, Maternity, Paternity).",
					"Set <b>From Date</b> and <b>To Date</b>. Total leave days auto-computes (excluding holidays and weekends).",
					"Enter <b>Reason</b> (optional but recommended).",
					"Save. Status becomes Open.",
					"Submit the Leave Application to send it to the approver queue.",
					"HR Manager reviews pending leaves from <b>HR Dashboard → Leaves tab</b> or directly from the Leave Application list.",
					"On Approve: status = Approved, leave balance deducted, Attendance for those days marked as On Leave.",
					"On Reject: status = Rejected, balance unchanged.",
				],
				note: "Leave balance for each leave type is visible in <b>My HR → Leave Summary</b>. You cannot apply for more leaves than your allocation. Half-day leaves: tick the Half Day checkbox and select which half (First/Second).",
				tip: "HR Manager can approve leaves inline from the HR Dashboard → Leaves tab without opening each application individually.",
			},
			{
				num: "31", title: "Auto-Absent Marking",
				desc: "Daily: marks yesterday Absent if no Attendance record exists. Skips weekends, state-specific holidays, employees on approved leave, and employees in Factory departments (their attendance comes from biometric device and must be imported separately).",
				tags: "absent auto mark attendance daily factory biometric skip department",
				note: "Factory employees (any department containing 'Factory') are always excluded. Their attendance must be entered manually or imported via biometric integration.",
			},
			{
				num: "8", title: "Payroll Processing",
				desc: "Two salary structures: IB Payroll (office) and Astro Payroll (factory). PF opt-in via provident_fund_account. ESIC opt-in via health_insurance_no (auto-skipped if base salary exceeds Rs 21,000).",
				tags: "payroll salary pf esic slip process",
				steps: [
					"Ensure each employee has a Salary Structure Assignment.",
					"PF opt-in: set <code>provident_fund_account</code> on the Employee record.",
					"ESIC opt-in: set <code>health_insurance_no</code> on the Employee record.",
					"Run Payroll: HRMS, Process Payroll, select month and company.",
					"Submit all salary slips. Post the payment journal.",
				],
			},
			{
				num: "33", title: "Full and Final Settlement",
				desc: "IB Full Final Settlement doctype: auto-computes years of service, gratuity (for 5+ years), leave encashment, total payable. Status flow: Draft, In Review, Approved, Paid.",
				link: "/app/ib-full-final-settlement", linkLabel: "F&F Settlement List",
				tags: "fnf final settlement gratuity exit",
			},
			{
				num: "3", title: "Employee Exit and Handover",
				desc: "Set relieving_date on the Employee (status can be Active or Left — either order works). On/after relieving day: Handover doc is created with all pending Quotations, Sales Orders, Delivery Notes, Sales Invoices, and HR Managers get a bell notification. The day after: user account auto-disabled.",
				tags: "exit handover relieve disable account",
			},
			{
				num: "47", title: "State-wise Holiday Lists",
				desc: "Three lists: Maharashtra, Tamil Nadu, Gujarat. Assign to each employee via the holiday_list field. The auto-absent scheduler respects these lists.",
				tags: "holiday state list attendance leave",
			},
			{
				num: "65", title: "Attendance Terminal (Admin Bulk Check-In)",
				desc: "Separate from the employee self-service /checkin portal. The Attendance Terminal page is for HR / Admin to bulk check-in or mark absent for factory and office employees in one operation. Access from Workspace → HR → Attendance Terminal.",
				link: "/app/attendance-terminal", linkLabel: "Attendance Terminal",
				tags: "attendance terminal bulk check admin factory office absent mark hr",
				steps: [
					"Go to <b>Workspace → HR → Attendance Terminal</b>.",
					"Filter by category: <b>Factory</b> or <b>Office</b>.",
					"The page shows all employees in that category with their current check-in status.",
					"Select employees and click <b>Check In</b> for bulk check-in.",
					"Click <b>Mark Absent</b> to mark selected employees absent.",
					"Late check-in (more than 10 min after shift start) or early check-out (more than 10 min before shift end) auto-triggers a reason dialog.",
					"Reason is saved to <code>custom_late_reason</code> on the Employee Checkin record.",
				],
				tip: "Employees without a default_shift assigned never trigger the late/early reason dialog.",
			},
			{
				num: "32", title: "IB Overtime Request",
				desc: "Employees submit overtime requests via IB Overtime Request (IB-OT-{YYYY}-{#####}). HR Manager approves or rejects. Fields: employee, date, shift, overtime_hours, reason.",
				link: "/app/ib-overtime-request", linkLabel: "Overtime Requests",
				tags: "overtime request employee hr manager approve reject hours shift",
				steps: [
					"Employee goes to <b>IB Overtime Request → New</b>.",
					"System defaults Date = today. Select the Shift.",
					"Enter Overtime Hours (must be greater than 0) and Reason.",
					"Save. Status moves to Pending Approval.",
					"HR Manager reviews: Approve or Reject with Approver Notes.",
					"Status flow: Draft → Pending Approval → Approved / Rejected.",
				],
				note: "Employee role: create and write. HR Manager role: full access including approve/reject. The approved_by and approver_notes fields are read-only for employees.",
			},
			{
				num: "49", title: "Employee Drive Sync",
				desc: "Documents attached to the Employee record (PANCARD, Aadhar, Passport, etc.) are auto-synced to Frappe Drive. The system creates an HR Documents team and a per-employee subfolder. A Drive link button appears on the Employee form.",
				tags: "drive sync employee documents folder team hr pancard aadhar passport",
				steps: [
					"Open the Employee record.",
					"Scroll to the <b>Employee Document</b> table (IB section).",
					"Add rows: select Document Type (PANCARD, AADHAR CARD, Passport, Education Certificate, etc.) and attach the file.",
					"Save. The system enqueues a background job that creates/updates the Drive folder and copies files.",
					"Click the <b>Open in Drive</b> button at the top of the Employee form to open the employee's Drive folder.",
				],
				note: "Drive hierarchy: HR Documents team → Employee Documents → {Name} folder → {Type} - {filename}. If the employee name changes, the Drive folder is renamed automatically. Deleting a child row in ERPNext does NOT delete the file from Drive.",
			},
			{
				num: "OC-1", title: "Org Chart",
				desc: "Interactive org chart showing the reporting hierarchy across all departments and employees. Access from Workspace → HR → Org Chart.",
				link: "/app/ib-org-chart", linkLabel: "Open Org Chart",
				tags: "org chart hierarchy reporting manager employee department structure",
			},
			{
				num: "35", title: "Employee Custom Fields (IB Section)",
				desc: "Custom fields added to the Employee form in the IB section: Emergency Contact, Emergency Phone, Notice Period Days (default 30), Previous Employer, Previous CTC, Current CTC, Location State (Maharashtra / Tamil Nadu / Gujarat). Location State is filterable in the Employee list.",
				tags: "employee custom fields emergency contact notice period previous employer ctc state location",
			},
			{
				num: "MY-HR", title: "My HR — Employee Self-Service Portal",
				desc: "Personal HR portal for each employee. Shows leave balances, recent leave applications, this month's attendance calendar, last 6 payslips, and overtime request history. Access any month's data via the month picker. No admin access needed — each employee sees only their own data.",
				link: "/app/ib-my-hr", linkLabel: "My HR",
				tags: "my hr self service leave balance attendance payslip overtime salary slip month picker personal portal employee",
				steps: [
					"Go to <b>Workspace → HR → My HR</b> (or navigate to /app/ib-my-hr).",
					"<b>Leave Summary:</b> all active leave allocations with used, remaining, and total days per leave type.",
					"<b>Recent Leave Applications:</b> last 30 applications with status (Pending/Approved/Rejected) and date range.",
					"<b>Attendance Calendar:</b> current month's attendance — Present (green), Absent (red), On Leave (blue), Half Day (orange). Use the month picker to view past months.",
					"<b>Payslips:</b> last 6 salary slips with gross, deductions, and net pay. Click any row to open the Salary Slip.",
					"<b>Overtime Requests:</b> recent IB Overtime Request records with status.",
				],
				note: "If no active Employee record is linked to your User account, the page shows an error. Contact HR to link your Employee record.",
			},
		],
	},
	{
		id: "ai", cat: "ai",
		icon: '<iconify-icon icon="lucide:bot" width="17" height="17"></iconify-icon>', color: "#fde8e0", iconColor: "#b85c3a",
		title: "AI Agents and Automation",
		roles: _AI,
		items: [
			{
				num: "AI.0", title: "AI Agent System — How It Works (22 Agents)",
				desc: "22 agents run daily across Sales, Production, HR, Finance, and Operations. Each agent reads live Frappe data, builds a deterministic action draft, and queues it as IB AI Action (status=pending). No action executes until a human approves it in the AI Inbox. Claude API optionally phrases the human-facing summary in natural language.",
				link: "/app/ib-ai-inbox", linkLabel: "Open AI Inbox",
				tags: "ai agent system overview 22 agents human in the loop approve reject claude llm deterministic ib ai action dedup daily schedule",
				steps: [
					"Agent reads live data (leads, WOs, attendance, invoices, POs, etc.).",
					"Agent builds a <b>deterministic draft</b> — the exact action to take.",
					"Optionally: Claude API (claude-haiku-4-5) phrases the human-facing summary in natural language.",
					"Action is written to <b>IB AI Action</b> (status=pending). <b>Deduplication</b>: one pending action per agent+reference per day.",
					"Human reviews in <b>AI Inbox</b> → Approve (executes) or Reject (dismisses).",
					"<b>IB Agent Run Log</b> records every run: agent code, trigger type, records processed, actions queued, status, errors.",
				],
				note: "If the Claude API key has no credits, agents still run — they use the deterministic fallback summary instead of the LLM-phrased one.",
			},
			{
				num: "AI.1", title: "Using the AI Inbox",
				desc: "Primary interface for all human-in-the-loop review. Pending AI actions appear here with agent badge, reference link, draft JSON preview, and approve/reject buttons. Full audit trail.",
				link: "/app/ib-ai-inbox", linkLabel: "Open AI Inbox",
				tags: "ai inbox approve reject pending filter badge reference json audit trail action card agent code",
				steps: [
					"Go to <b>Workspace → AI Agents → AI Inbox</b>.",
					"Default view: Status = Pending. Filter by <b>agent code</b> to focus (e.g. 'auto_quote', 'collections', 'hr_leave_pending').",
					"Each action card shows: <b>agent badge</b> (color-coded), <b>title</b>, <b>LLM or deterministic summary</b>, <b>reference link</b> (Lead, WO, Employee, Invoice), <b>draft JSON preview</b>.",
					"Click <b>Approve</b>: executes the action (creates document, sends bell, sends WhatsApp — depends on action_type).",
					"Click <b>Reject</b>: dismisses without executing. Both record user + timestamp.",
					"Status flow: pending → approved / rejected. Approved cards show what was created/sent.",
				],
				tip: "Filter agent=collections to review dunning WhatsApp messages before they send. Filter agent=auto_quote to batch-approve or reject lead quotation suggestions.",
			},
			{
				num: "AI.2", title: "Running Agents Manually and On-Demand",
				desc: "Trigger all 22 agents immediately from the AI Inbox page, or run a single agent by code. Useful for testing or when you need fresh suggestions without waiting for the midnight scheduler.",
				link: "/app/ib-ai-inbox", linkLabel: "AI Inbox",
				tags: "run agents manually trigger all single agent code now immediate on demand manual schedule",
				steps: [
					"Go to <b>AI Inbox → Run All Agents</b> button (top-right toolbar).",
					"All 22 agents run immediately (trigger_type = 'manual'). New pending actions appear — refresh to see.",
					"To run one agent: via the Agent Run Log page or API call.",
					"Results appear as new IB AI Actions in pending status.",
				],
			},
			{
				num: "AI.3", title: "IB Agent Run Log — Audit Every Execution",
				desc: "IB Agent Run Log records every agent execution. Use it to verify agents ran, see error details, and check how many records were processed and actions queued.",
				link: "/app/ib-agent-run-log", linkLabel: "Agent Run Log",
				tags: "agent run log audit history trigger type schedule manual success failed error records actions processed",
				steps: [
					"Go to <b>IB Agent Run Log</b> list.",
					"Columns: agent_code, trigger_type (schedule/manual), status (running/success/failed), run_at, records_processed, actions_taken, error_details.",
					"If status = failed: read error_details to diagnose the issue.",
					"Daily runs happen at midnight via Frappe scheduler (run_daily_agents).",
				],
			},
			{
				num: "AI.S1", title: "Sales Agents — 6 Agents",
				desc: "6 agents cover the full revenue and inventory cycle: lead-to-quote conversion, demand forecasting, smart reordering, collections dunning, work order escalation, and customer follow-ups.",
				tags: "sales agents auto_quote demand_forecast smart_reorder collections istix_enforcer buying_dna daily lead quotation material request whatsapp followup",
				steps: [
					"<b>auto_quote</b> — Leads with status Open/Interested/Replied + lead_score > 30 + product interest set → drafts a Quotation. On Approve: creates Draft Quotation linked to the Lead.",
					"<b>demand_forecast</b> — Analyzes 12 weeks of Sales Invoice items → 4-week demand forecast for top 30 SKUs. On Approve: logs informational forecast card (no document created).",
					"<b>smart_reorder</b> — Items at or below reorder level in bin → drafts a Material Request per item. On Approve: creates Draft Material Request.",
					"<b>collections</b> — Sales Invoices overdue >30 days → Claude writes India-context dunning WhatsApp message per customer. On Approve: sends WhatsApp via the assigned rep's session.",
					"<b>istix_enforcer</b> — IB Work Orders stalled In Progress >24 hours → escalates to Manufacturing Manager. On Approve: sends bell notification with WO name, stage, and hours stalled.",
					"<b>buying_dna</b> — Customers overdue for a follow-up call based on monthly order pattern → creates ToDo for the sales rep. On Approve: creates ToDo with customer name and last order date.",
				],
			},
			{
				num: "AI.P1", title: "Production Agents — 7 Agents",
				desc: "7 production-specific agents cover order sheet auto-creation, machine assignment, stage advancement, wastage quality flags, priority escalation, RTD notification, and job bundling.",
				tags: "production agents prod_advance prod_machine_assign prod_notify_ready prod_auto_os prod_job_bundle prod_wastage_flag prod_priority_escalate",
				steps: [
					"<b>prod_advance</b> — WOs with completed_qty ≥ 85% of target_qty → suggests completing and advancing to next stage.",
					"<b>prod_machine_assign</b> — Pending WOs with no machine for ≥1 day → suggests load-balanced machine by stage type + location.",
					"<b>prod_notify_ready</b> — All items in an Order Sheet at RTD → queues bell notification to the SO's sales person.",
					"<b>prod_auto_os</b> — Submitted SOs with no Order Sheet → suggests creating one (priority derived from delivery date).",
					"<b>prod_job_bundle</b> — Multiple Pending WOs for same item+stage → suggests batch machine assignment.",
					"<b>prod_wastage_flag</b> — Production Entries where wastage_pct > machine wastage_norm_pct → flags to Manufacturing Manager.",
					"<b>prod_priority_escalate</b> — Urgent/High WOs Pending or On Hold for excessive time → escalates to Manufacturing Manager.",
				],
				note: "Production agents appear in both AI Inbox and the Production Dashboard AI Actions panel.",
			},
			{
				num: "AI.H1", title: "HR Agents — 4 Agents",
				desc: "4 HR agents automate leave approval nudges, attendance gap alerts, month-end payroll reminders, and late check-in flags. Filter AI Inbox by agent=hr_* to see them.",
				tags: "hr agents hr_leave_pending hr_attendance_gap hr_payroll_nudge hr_late_checkin leave approve absent payroll reminder late checkin flag",
				steps: [
					"<b>hr_leave_pending</b> — Leave Applications open >2 days with no approval → nudges the leave_approver. On Approve: sends bell to approver.",
					"<b>hr_attendance_gap</b> — Employees with 3+ Absent days in last 7 days → alerts HR Manager and the employee's reporting manager.",
					"<b>hr_payroll_nudge</b> — Fires only when month-end is ≤3 days away AND salary slips are incomplete. On Approve: sends bell to HR Manager with pending slip count.",
					"<b>hr_late_checkin</b> — Employees with 3+ late arrivals this month → flags to HR Manager. On Approve: sends bell with count.",
				],
			},
			{
				num: "AI.F1", title: "Finance Agents — 3 Agents",
				desc: "3 finance agents flag overdue payables, pending expense submissions, and unreconciled bank transactions. Filter AI Inbox by agent=finance_* to see them.",
				tags: "finance agents finance_payable_due finance_expense_pending finance_bank_recon payable due draft bill unreconciled bank transaction accounts manager",
				steps: [
					"<b>finance_payable_due</b> — Purchase Invoices due within 5 days with outstanding amount > 0 → alerts Accounts Manager. On Approve: sends bell notification.",
					"<b>finance_expense_pending</b> — Purchase Invoices in Draft status >3 days → nudges Accounts Manager to review and submit.",
					"<b>finance_bank_recon</b> — Bank Transactions (Unreconciled) older than 7 days → alerts Accounts Manager with count. On Approve: sends bell notification.",
				],
			},
			{
				num: "AI.O1", title: "Operations Agents — 3 Agents",
				desc: "3 operations agents monitor overdue Purchase Orders, delivery risk on Sales Orders, and aging stock. Filter AI Inbox by agent=ops_* to see them.",
				tags: "operations agents ops_po_overdue ops_delivery_risk ops_stock_aging purchase order overdue delivery risk stock aging warehouse purchase manager",
				steps: [
					"<b>ops_po_overdue</b> — Purchase Orders past Schedule Date with pending qty → alerts Purchase Manager. On Approve: sends bell notification.",
					"<b>ops_delivery_risk</b> — Submitted SOs past delivery_date with no submitted Delivery Note → flags to Sales Manager. On Approve: sends bell to the rep.",
					"<b>ops_stock_aging</b> — Items with stock older than 90 days → flags to Warehouse Manager for write-off or discount review. On Approve: sends bell with item list.",
				],
			},
		],
	},
	{
		id: "broadcast", cat: "comms",
		icon: '<iconify-icon icon="lucide:bell" width="17" height="17"></iconify-icon>', color: "#e0f0ff", iconColor: "#1a60b0",
		title: "Broadcast and WhatsApp",
		roles: _SALES,
		items: [
			{
				num: "87", title: "System Broadcast (In-App)",
				desc: "System Managers send announcements to all or specific users. Real-time via WebSocket. Offline users see broadcasts on next login (last 48 hours shown).",
				tags: "broadcast announce message users notification bell",
				steps: [
					"Go to <b>Workspace, WA Broadcast</b>.",
					"Enter Title and Message. Optionally attach an image.",
					"Select Target: All Users or Specific Users.",
					"Click Send. Message appears immediately for logged-in users.",
				],
			},
			{
				num: "83", title: "Sending WhatsApp Message from Document",
				desc: "Open any sales document, click WhatsApp button, select template, preview message, optionally attach PDF, then Send.",
				tags: "whatsapp wa message send template",
				steps: [
					"Open any sales document (SO, SI, DN).",
					"Click the <b>WhatsApp</b> button.",
					"Select a Template (configured in IB WA Template).",
					"Preview the message — variables auto-filled.",
					"Optionally attach PDF (Packing List for DN, Tax Invoice for SI).",
					"Click Send.",
				],
			},
			{
				num: "WA.1", title: "Setting Up a WhatsApp Session",
				desc: "IB WA Session, New, set Session ID and Phone, click Generate QR, scan with WhatsApp phone. Status changes to Connected.",
				link: "/app/ib-wa-session", linkLabel: "WA Sessions",
				tags: "wa whatsapp session qr setup connect",
			},
			{
				num: "WA.2", title: "Send Outstanding Statement via WhatsApp",
				desc: "Sends the customer's full list of unpaid invoices (due date, amount, overdue flag) as a WhatsApp text message directly from the Customer form.",
				tags: "outstanding statement wa whatsapp invoice unpaid due overdue balance customer",
				steps: [
					"Open any <b>Customer</b> form.",
					"Click <b>WhatsApp → Send Outstanding Statement</b>.",
					"Confirm the prompt — message is built and sent immediately.",
					"Message lists up to 30 outstanding Sales Invoices with invoice number, due date, amount, and ⚠️ flag for overdue.",
					"Total outstanding is shown at the bottom of the message.",
					"Send status is logged in <b>IB WA Log</b>.",
				],
				note: "Requires the customer to have a mobile number (Primary Contact or mobile_no field) and the user to have a connected IB WA Session. Does not attach a PDF — text only.",
				tip: "Use this before a customer visit or payment follow-up call so the customer already has their dues on WhatsApp.",
			},
			{
				num: "83b", title: "Automated Dormant Customer Blast",
				desc: "Daily scheduler sends a WhatsApp re-engagement message to customers with no Sales Order in 30+ days via the assigned rep's session. Deduplicated (1 per customer per 30 days).",
				tags: "dormant blast auto wa customer 30 days",
			},
			{
				num: "RAVEN-1", title: "Raven — Internal Team Chat",
				desc: "Raven is the internal team chat app for Instabiz staff — separate from the customer-facing WhatsApp integration above. Direct messages, channels, and file sharing between colleagues.",
				link: "/raven", linkLabel: "Open Raven",
				tags: "raven chat internal messaging dm channel team communication",
				steps: [
					"Open Raven from the app switcher (top-left, grid icon) or go directly to <code>/raven</code>.",
					"<b>General channel</b> — every staff member is a member by default; use it for company-wide messages.",
					"<b>Direct Messages</b> — click a colleague's name in the People list to start a 1:1 chat.",
					"<b>New Channel</b> — create a topic or team-specific channel; invite the relevant people.",
					"<b>File sharing</b> — drag and drop or use the attach button inside any conversation.",
				],
				note: "Every enabled user account automatically has Raven access (Raven User role). If someone can't see other people in Raven, it's almost always because they haven't been added to the Raven workspace/General channel yet — contact a System Manager.",
			},
		],
	},
	{
		id: "customerboard", cat: "crm",
		icon: '<iconify-icon icon="lucide:tag" width="17" height="17"></iconify-icon>', color: "#e3f2fd", iconColor: "#1565c0",
		title: "Customer Board and Daily Assignments",
		roles: _SALES,
		items: [
			{
				num: "CB-1", title: "Customer Board — 4-Column Kanban",
				desc: "Workspace → Customer Board. Shows your assigned customers in 4 columns: <b>Dormant</b> (no SO in 60+ days), <b>Regular</b> (active customers with history), <b>Today</b> (to contact today), <b>Tomorrow</b> (scheduled for tomorrow). Use the date picker to view any day's plan.",
				link: "/app/ib-customer-board", linkLabel: "Open Customer Board",
				tags: "customer board kanban dormant regular today tomorrow daily plan contact schedule assignment",
				steps: [
					"Go to <b>Workspace → Customer Board</b>.",
					"Default view is today. Use the date picker to change the date.",
					"<b>Dormant</b> column: customers not ordered in 60+ days — prioritize re-engagement.",
					"<b>Regular</b> column: active customers available to schedule for contact.",
					"<b>Today</b> column: customers you need to contact today.",
					"<b>Tomorrow</b> column: tomorrow's scheduled contacts (auto-assigned at midnight).",
					"Click <b>Add to Today</b> on a Dormant or Regular card to schedule it for today.",
					"When a Sales Order is submitted for a customer, their Today assignment is auto-marked done.",
				],
				tip: "Your monthly sales target card appears above the columns — shows target amount and MTD revenue so far. The midnight scheduler auto-assigns tomorrow's batch based on your territory.",
			},
			{
				num: "CB-2", title: "Assignment Admin — Manager Roster View",
				desc: "Workspace → Sales & CRM → Assignment Admin. Sales Managers see all reps in a roster with avatar, stats (assigned today, completed, pending), and a sales target progress bar per rep. View-as lets managers see and operate any rep's full kanban.",
				link: "/app/ib-assignment-admin", linkLabel: "Assignment Admin",
				tags: "assignment admin manager roster pool assign territory view as kanban all reps",
				steps: [
					"Go to <b>Workspace → Assignment Admin</b>.",
					"Roster cards: each rep's avatar, assigned count, completed count, pending count, target progress bar.",
					"Click <b>View As</b> on a rep's card to load their full 4-column Customer Board.",
					"As manager you can add or remove customers from any rep's board on their behalf.",
					"<b>Customer Pool panel</b>: always visible. Select a user, a date, then choose customers from the pool list.",
					"Click <b>Assign</b> to batch-assign those customers to that rep for that date.",
				],
				note: "Pool pagination: 50 customers per page. Filter pool by territory. Manager actions are full CRUD — no restrictions on which rep's board is edited.",
			},
			{
				num: "CB-3", title: "IB Assignment Config — Batch Size and Dormant Rules",
				desc: "Singleton doctype that controls how the midnight scheduler builds tomorrow's auto-assigned customer lists: how many customers per rep, how many days without an order = dormant, and what fraction of each day's batch should be dormant customers.",
				link: "/app/ib-assignment-config", linkLabel: "Assignment Config",
				tags: "assignment config batch size dormant threshold days ratio scheduler auto midnight",
				steps: [
					"Search <b>IB Assignment Config</b> in the top bar (System Manager).",
					"Set <b>Assignments Per Day</b>: total customers assigned to each rep per day (e.g. 10).",
					"Set <b>Dormant Threshold Days</b>: days since last SO to classify a customer as Dormant (e.g. 60).",
					"Set <b>Dormant Ratio %</b>: what percentage of each day's batch should be dormant customers (e.g. 30%).",
					"Save. The midnight scheduler uses these values to build tomorrow's auto-assigned lists for all reps.",
				],
				note: "Auto-assignment runs every night at 12 AM. Manually added cards (via Customer Board or Assignment Admin) are not affected by the scheduler.",
			},
			{
				num: "CB-4", title: "IB Customer Assignment — Individual Assignment Record",
				desc: "Each assignment is one IB Customer Assignment (ICA-.YYYY.-#####) record: customer, assigned_to (User), assigned_date, status (Pending/Contacted/Order Placed/Skipped/Rolled Over), source_pool (Dormant/Regular), territory, outcome.",
				link: "/app/ib-customer-assignment", linkLabel: "Customer Assignment List",
				tags: "customer assignment record pending contacted order placed skipped rolled over status outcome",
				note: "Submitting a Sales Order for a customer on their assignment date auto-updates the assignment status to Order Placed.",
			},
		],
	},
	{
		id: "production", cat: "production",
		icon: '<iconify-icon icon="lucide:factory" width="17" height="17"></iconify-icon>', color: "#fff3e0", iconColor: "#e65100",
		title: "Production Module",
		roles: _PROD,
		items: [
			{
				num: "PROD-0", title: "Production Module — Overview",
				desc: "Tracks raw materials (Jumbo Rolls) through 7 manufacturing stages to finished goods. Links Sales Orders → Order Sheets → Work Orders → Machines → Production Entries. All data flows to the Production Dashboard and DPR report. Roles: System Manager, Factory Management, Sales Manager. Doctypes: IB Work Order, IB Order Sheet, IB Machine, IB Production Entry, IB Jumbo Roll.",
				link: "/app/ib-production-stages", linkLabel: "Open Production Stages",
				tags: "production overview manufacturing module doctypes roles work order order sheet machine jumbo roll entry",
			},
			{
				num: "PROD-1", title: "Stage Routing by Item Group — Which Stages Each Product Goes Through",
				desc: "Not all products go through all 7 stages. Stage routing is determined automatically by the item's item_group field when Work Orders are created from an Order Sheet.",
				link: "/app/ib-production-stages", linkLabel: "Open Pipeline",
				tags: "stages item group routing plastic pvc cloth foam aerosol sealant bopp paper reflective skips coating rewinding cutting packing",
				steps: [
					"<b>PLASTIC / BOPP / PAPER / REFLECTIVE (all 7 stages):</b> Coating → Slitting → Rewinding → Cutting → Packing → Ready to Deliver → Delivered.",
					"<b>PVC / CLOTH / FOAM (skip Coating + Rewinding, 5 stages):</b> Slitting → Cutting → Packing → Ready to Deliver → Delivered.",
					"<b>AEROSOL / SEALANT (2 active stages only):</b> Packing → Ready to Deliver → Delivered.",
					"<b>Default (unknown item group, 3 stages):</b> Cutting → Packing → Ready to Deliver.",
					"Stage routing auto-applies when WOs are created. Manual override: use the Product-wise matrix + icon to add a WO at any stage.",
				],
				note: "Stages that don't apply to an item group are simply skipped — no WOs are created for them. The pipeline kanban only shows WOs that exist.",
			},
			{
				num: "PROD-2", title: "The 7 Stages — What Each One Does",
				desc: "Each stage = one IB Work Order. Stage colors are consistent across all views: Coating=purple, Slitting=blue, Rewinding=cyan, Cutting=green, Packing=amber, RTD=orange, Delivered=teal.",
				tags: "stages coating slitting rewinding cutting packing ready to deliver delivered fields entry color",
				steps: [
					"<b>1. Coating</b> — Raw Jumbo Roll coated with adhesive. Entry fields: jumbo_roll_width, jumbo_roll_length, coating_speed (m/min), adhesive_consumption (kg).",
					"<b>2. Slitting</b> — Coated roll slit into narrower rolls. Entry fields: no_of_slits, slit_widths (mm, comma-separated), edge_trim_width.",
					"<b>3. Rewinding</b> — Slit rolls rewound onto cores. Entry fields: no_of_logs, log_length, core_size (1/1.5/2/3 inch). Skipped for PVC/CLOTH/FOAM.",
					"<b>4. Cutting</b> — Logs cut to final product length. Entry fields: cut_length, pieces_per_log.",
					"<b>5. Packing</b> — Finished goods packed and QC checked. Entry fields: packing_type (Carton/Shrink Wrap/Poly Bag/Loose), pieces_per_carton, cartons_packed, qc_status (Pass/Fail/Pending).",
					"<b>6. Ready to Deliver (RTD)</b> — Goods confirmed ready. Sales person receives a bell notification when all items for an order reach this stage.",
					"<b>7. Delivered</b> — Goods dispatched against Delivery Note. Sales creates DN from the SO; this stage is automatically reached.",
				],
			},
			{
				num: "PROD-3", title: "IB Order Sheet — Create and Manage",
				desc: "An Order Sheet = production plan for one Sales Order. Groups all Work Orders for all stages across all items in one view. Must exist before Work Orders can be created for an SO.",
				link: "/app/ib-order-sheet", linkLabel: "IB Order Sheet List",
				tags: "order sheet os create sales order priority delivery date auto scheduler new button",
				steps: [
					"<b>Method 1 — From Sales Order:</b> Open a submitted SO → click <b>Create Order Sheet</b> button in the header.",
					"<b>Method 2 — From Production Stages:</b> Order-wise tab → <b>+ New Order Sheet</b> button → select SO, set Priority and Notes.",
					"<b>Method 3 — Auto-scheduler:</b> Daily midnight job scans submitted SOs without an Order Sheet and auto-creates them. Priority is set by delivery date: ≤2 days = Urgent, ≤5 = High, ≤10 = Normal, >10 = Low.",
					"After creation: Work Orders are auto-created per stage per item based on item group routing.",
					"Set <b>Priority</b> (Urgent/High/Normal/Low) and optional <b>Delivery Date</b>.",
					"n8n webhook fires on Order Sheet creation if configured.",
				],
				note: "One SO = one Order Sheet. Attempting to create a second Order Sheet for the same SO will show an error.",
			},
			{
				num: "PROD-4", title: "IB Work Order — Status Lifecycle and Key Fields",
				desc: "A Work Order = one item at one production stage. Status flows: Pending → In Progress → Completed (or On Hold between In Progress and Completed). System auto-advances to next stage on completion.",
				link: "/app/ib-work-order", linkLabel: "IB Work Order List",
				tags: "work order status lifecycle pending in progress on hold completed fields stage machine operator qty started completed advance next",
				steps: [
					"<b>Key fields:</b> order_sheet, sales_order, item_code, stage, machine, operator, priority, target_qty, completed_qty, wastage_qty, started_at, completed_at, batch_group.",
					"<b>Pending</b> — WO created, not started. Assign machine here (load-balanced suggestion available).",
					"<b>In Progress</b> — Click Start. Records started_at. Log production entries throughout.",
					"<b>On Hold</b> — Pause mid-stage (machine breakdown, end of shift). Click On Hold. Resume: click Start again.",
					"<b>Completed</b> — Click Complete. Enter completed_qty + wastage_qty. System auto-creates next-stage WO and activates it in the pipeline.",
					"Completing the last applicable stage (per item group routing) marks the entire item as production-complete.",
					"n8n webhook fires on every status change.",
				],
				note: "WO names follow pattern IB-WO-{STAGE}-{YYYY}-{#####}. WOs can also be viewed in the standard IB Work Order list with filters.",
			},
			{
				num: "PROD-5", title: "Production Dashboard — All Sections",
				desc: "Workspace → Production Dashboard. Real-time factory floor overview. 4 KPI cards, pipeline summary, priority strip, wastage card, AI actions panel, active plan table, recent entries, and n8n status bar.",
				link: "/app/ib-production-dashboard", linkLabel: "Open Production Dashboard",
				tags: "production dashboard kpi active pending completed today machines wastage ai actions plan entries n8n pipeline priority strip",
				steps: [
					"<b>KPI Card 1 — Active Work Orders:</b> all WOs not Completed/Cancelled. Click → filtered IB Work Order list.",
					"<b>KPI Card 2 — Pending:</b> WOs not yet started. Click → filtered list.",
					"<b>KPI Card 3 — Completed Today:</b> WOs completed today. Click → filtered list.",
					"<b>KPI Card 4 — Machines Active:</b> machines with In Progress WOs right now. Click → IB Machine list.",
					"<b>Stage Pipeline:</b> 7 stage cards each showing Pending / In Progress / Completed counts + color progress bar. Click any card → Production Stages page.",
					"<b>Priority Strip:</b> Urgent / High / Normal / Low badge counts across all active WOs.",
					"<b>Avg Wastage Card:</b> today's average wastage %. Green <2%, orange 2–5%, red >5%.",
					"<b>AI Production Actions Panel:</b> pending actions from production agents (prod_advance, prod_machine_assign, prod_notify_ready, prod_auto_os, prod_job_bundle) with Approve/Reject buttons.",
					"<b>Active Production Plan Table:</b> current Order Sheets with SO#, customer, items, current stage, stage chip progress row, priority, overall progress bar.",
					"<b>Recent Entries:</b> last 10 Production Entries — date, stage, machine, output qty, wastage %.",
					"<b>Quick Buttons:</b> Production Stages →, Order Sheets →, DPR Report →.",
					"<b>n8n Status Bar:</b> shows Connected / Not Configured + Test Webhook button.",
					"<b>Toolbar:</b> Refresh button top-right.",
				],
			},
			{
				num: "PROD-6", title: "Pipeline Tab — Kanban with Drag-and-Drop",
				desc: "Production Stages → Pipeline tab (default view). 7 columns, one per stage. Work Order cards in each column. Drag to move stages. Click card body to open side panel.",
				link: "/app/ib-production-stages", linkLabel: "Open Pipeline",
				tags: "pipeline kanban drag drop stage columns card inline actions start next hold resume refresh esc keyboard",
				steps: [
					"Go to <b>Production Stages</b> — Pipeline is the default tab.",
					"<b>Column header:</b> colored stage icon + stage name + WO count badge.",
					"<b>WO Card shows:</b> item_code (bold), priority badge (Urgent/High/Normal/Low), customer name, machine chip (yellow 'No machine' if unset), qty chip, progress bar (completed / target qty), status chip.",
					"<b>Card inline action buttons (bottom strip):</b>",
					"  → <b>Start</b> (green) — appears for Pending WOs. Sets status to In Progress.",
					"  → <b>Next Stage</b> (blue) + <b>Hold ⏸</b> (amber) — appears for In Progress WOs. Next Stage completes WO and auto-advances. Hold pauses it.",
					"  → <b>Resume</b> (green) — appears for On Hold WOs.",
					"<b>Click the card body</b> (not the buttons) to open the right-side detail panel.",
					"<b>Drag a card</b> to a different column to reassign its stage. Saves immediately to the WO.",
					"<b>Keyboard shortcuts:</b> Esc = close panel; R (when not in an input) = refresh board.",
				],
				note: "Columns scroll independently. Drag handles activate on mousedown on the card body. SortableJS powers the drag-and-drop.",
			},
			{
				num: "PROD-7", title: "Work Order Side Panel — All Buttons",
				desc: "Click any WO card body in the Pipeline to open the right-side detail panel. Shows full WO info, action buttons, and entry history.",
				tags: "side panel work order assign machine start hold complete link jumbo roll new entry buttons panel history",
				steps: [
					"<b>Panel Header:</b> WO name (monospace), item code, stage chip (colored), priority badge, status chip, machine name.",
					"<b>Assign Machine</b> — shows if no machine assigned. Opens dropdown of Active machines for that stage type. Load-balanced suggestion auto-selected.",
					"<b>Start</b> — visible when status = Pending or Draft. Sets In Progress, records started_at.",
					"<b>On Hold</b> — visible when In Progress. Pauses WO (e.g. machine breakdown).",
					"<b>Complete</b> — visible when In Progress. Completes WO, triggers auto-advance to next stage.",
					"<b>Link Jumbo Roll</b> — visible on Coating or Slitting WOs with no JR linked. Opens picker showing In Stock and In Production rolls with batch_no, SQMT, dimensions.",
					"<b>+ New Entry</b> — opens the production entry dialog (time, operator, input/output qty, stage-specific fields, wastage).",
					"<b>Entries History</b> — list of all submitted entries for this WO: date, operator, output qty, wastage %.",
				],
				note: "Panel closes with Esc. Completing a WO from the panel auto-refreshes the pipeline column.",
			},
			{
				num: "PROD-8", title: "Logging a Production Entry",
				desc: "Production entries record shift-level input/output data per Work Order. Used for DPR, wastage analytics, and machine performance tracking.",
				tags: "production entry log new entry dialog input output qty uom time operator wastage reason stage fields submit",
				steps: [
					"Open a WO card in Pipeline → side panel → click <b>+ New Entry</b>.",
					"<b>Section 1 — Time & Operator (grey):</b> Entry Date (today default), Operator (User link), Start Time, End Time. Hours worked auto-calculated.",
					"<b>Section 2 — Input / Output (blue):</b> Input Qty + UOM (MTR/KG/NOS/SQMT/PCS), Output Qty + UOM.",
					"<b>Section 3 — Stage Details (purple, varies by stage):</b>",
					"  → Coating: jumbo_roll_width, jumbo_roll_length, coating_speed, adhesive_consumption.",
					"  → Slitting: no_of_slits, slit_widths, edge_trim_width.",
					"  → Rewinding: no_of_logs, log_length, core_size (1in / 1.5in / 2in / 3in).",
					"  → Cutting: cut_length, pieces_per_log.",
					"  → Packing: packing_type (Carton/Shrink Wrap/Poly Bag/Loose), pieces_per_carton, cartons_packed, qc_status (Pass/Fail/Pending).",
					"<b>Section 4 — Wastage (red):</b> Wastage Qty, Wastage Reason (Defective Material / Machine Error / Operator Error / Edge Trim / Start-up Waste / Other), Wastage Notes.",
					"Click <b>Save & Submit</b>. Wastage % auto-computed. Entry doctype: IB Production Entry (auto-submitted).",
				],
				note: "Wastage % = (wastage_qty / input_qty) × 100. Above machine's wastage_norm_pct → shown as ABOVE NORM in DPR.",
			},
			{
				num: "PROD-9", title: "Item-wise Tab — Per-Item Stage Progress and Batch Lineage",
				desc: "Production Stages → Item-wise tab. Each item card shows all active stages, completion %, linked Jumbo Rolls. Click for stage table and batch lineage traceability.",
				tags: "item wise tab item code stages active completion jumbo roll batch lineage link search",
				steps: [
					"Click the <b>Item-wise</b> tab.",
					"<b>Item cards:</b> item_code (bold), item name, active stage chips (color-coded), overall completion %, Jumbo Roll pills.",
					"<b>Search:</b> type in the search box to filter by item code.",
					"<b>Click a card</b> to expand detail:",
					"  → <b>Stage Progress table:</b> each stage with chip, WO name, status, assigned machine, progress bar.",
					"  → <b>Link Jumbo Roll buttons:</b> appear on Coating/Slitting WOs with no JR. Click to link.",
					"  → <b>Batch Lineage section:</b> shows JR batch_no → which WOs consumed it → output chain.",
				],
				tip: "Use batch lineage to trace quality issues back to specific raw material batches.",
			},
			{
				num: "PROD-10", title: "Order-wise Tab — Order Sheet List and Stage Matrix",
				desc: "Production Stages → Order-wise tab. Lists all Order Sheets with filters. Click into one for three detail subtabs.",
				tags: "order wise tab sheet list filter status priority subtab matrix product stage machine create wo new order sheet",
				steps: [
					"Click the <b>Order-wise</b> tab.",
					"<b>Filters:</b> Status (All / Draft / In Progress / Completed), Priority (All / Urgent / High / Normal / Low).",
					"<b>Table columns:</b> OS#, Sales Order, Customer, Items count, Progress bar, Priority badge, Status, View button.",
					"<b>+ New Order Sheet button</b> — opens dialog: Sales Order (link), Priority, Notes. Creates Order Sheet and auto-generates WOs.",
					"<b>Click View / a row</b> → Order Sheet detail with 3 subtabs:",
					"  → <b>Order-wise subtab:</b> items list with their Work Orders per stage (WO name, status, machine, progress).",
					"  → <b>Product-wise subtab:</b> stage matrix — rows = items, columns = 7 stages. Icons: ✓ (Completed, green), ▶ animated (In Progress, blue), ⏱ (Pending, grey), + (no WO exists — click to create one instantly).",
					"  → <b>Machine-wise subtab:</b> machine cards showing all WOs from this Order Sheet assigned to each machine.",
				],
				note: "Clicking + in the Product-wise matrix directly creates a WO for that item at that stage without any dialog.",
			},
			{
				num: "PROD-11", title: "Machine-wise Tab — Machine Load and Stats",
				desc: "Production Stages → Machine-wise tab. All active machines with live load, today's output, wastage, and WO list. Create and edit machines from here.",
				tags: "machine wise tab load output wastage capacity edit create new machine card entries today stats",
				steps: [
					"Click the <b>Machine-wise</b> tab.",
					"<b>Machine card shows:</b> machine code (bold), machine type (color badge: Coating=purple, Slitting=blue, Rewinding=cyan, Cutting=green, Packing=amber), location badge, load % bar.",
					"<b>Today stats:</b> output qty, avg wastage %, entries count, capacity utilization.",
					"<b>Load % color:</b> green <60%, orange 60–90%, red >90%.",
					"<b>Wastage color:</b> red if above machine's wastage_norm_pct, green if at or below.",
					"<b>WO list on card:</b> active WOs assigned to this machine with status chips.",
					"<b>Edit button:</b> change capacity, UOM, wastage norm, location, status (Active/Inactive/Maintenance).",
					"<b>+ New Machine button</b> (top right): machine_code, machine_name, machine_type (Coating/Slitting/Rewinding/Cutting/Packing), location (maharashtra/gujarat/chennai), capacity, capacity_uom (m/min / kg/hr / rolls/shift / pcs/hr), wastage_norm_pct, status.",
				],
				note: "Machine type must match stage — only Coating machines appear in the Coating WO Assign Machine picker.",
			},
			{
				num: "PROD-12", title: "Job Bundles Tab — Batch Machine Assignment",
				desc: "Production Stages → Job Bundles tab. Groups Pending Work Orders that share the same item_code and stage. Batch-assign all WOs in a bundle to one machine in a single click.",
				tags: "job bundles tab batch assign machine pending work orders same item stage group efficiency",
				steps: [
					"Click the <b>Job Bundles</b> tab.",
					"Bundles form automatically when 2+ Pending WOs share the same item_code and stage.",
					"<b>Bundle card header:</b> item code, stage chip, WO count badge, total qty, suggested machine (load-balanced).",
					"<b>Bundle table rows:</b> WO name, Sales Order, Customer, target qty, Priority badge, batch_group label.",
					"<b>Batch Assign button</b> (top-right of card): opens dialog — select Machine (suggested machine pre-filled), optional Batch Group label. Click Assign. All WOs in the bundle get assigned to that machine simultaneously.",
					"Batch Group label tags all WOs in the bundle for easy filtering later.",
				],
				tip: "Use Job Bundles when multiple customers ordered the same item — run one machine continuously and assign all at once.",
			},
			{
				num: "PROD-13", title: "IB Jumbo Roll — Raw Material Traceability",
				desc: "Each incoming raw material roll is logged as an IB Jumbo Roll. Linked to Coating/Slitting WOs for full batch lineage. Tracks which raw roll produced which finished goods.",
				link: "/app/ib-jumbo-roll", linkLabel: "IB Jumbo Roll List",
				tags: "jumbo roll raw material batch traceability link coating slitting in stock in production consumed status batch no gsm width length liner",
				steps: [
					"Create <b>IB Jumbo Roll</b> when material arrives: supplier, received_date, batch_no, GSM, width_mm, length_mtr, liner_type. Status = In Stock.",
					"Open a Coating or Slitting WO in Pipeline view → side panel → click <b>Link Jumbo Roll</b>.",
					"Picker shows available rolls: batch_no, SQMT, width, length, status (In Stock / In Production).",
					"Select a roll. Status changes to In Production. A roll cannot be linked to two active WOs simultaneously.",
					"After WO completion: roll is logically consumed (status = Consumed).",
					"In Item-wise tab: click item card → Batch Lineage section shows full chain: JR batch_no → WOs → finished items.",
				],
				note: "Only Coating and Slitting stages have the Link Jumbo Roll button. Other stages inherit the lineage from upstream.",
			},
			{
				num: "PROD-14", title: "IB Machine — Setup and Configuration",
				desc: "Machines must be created before they can be assigned to Work Orders. Machine Type determines which stage's picker they appear in. Status controls visibility.",
				link: "/app/ib-machine", linkLabel: "IB Machine List",
				tags: "machine setup configuration new machine type location capacity uom wastage norm active inactive maintenance",
				steps: [
					"Go to <b>Machine-wise tab → + New Machine</b> or <b>IB Machine List → New</b>.",
					"<b>machine_code:</b> short identifier (CTG-01, SLT-02, RWD-01, CUT-03, PKG-01).",
					"<b>machine_name:</b> full descriptive name.",
					"<b>machine_type:</b> Coating / Slitting / Rewinding / Cutting / Packing. Must match the stage.",
					"<b>location:</b> maharashtra / gujarat / chennai.",
					"<b>capacity + capacity_uom:</b> e.g. 150 m/min, 500 kg/hr, 8 rolls/shift, 2000 pcs/hr.",
					"<b>wastage_norm_pct:</b> acceptable wastage baseline. Entries above this show red in DPR.",
					"<b>status:</b> Active (appears in assignment pickers), Inactive (hidden), Maintenance (orange badge in Machine-wise tab).",
				],
			},
			{
				num: "PROD-15", title: "DPR — Daily Production Report (Daily and Weekly Views)",
				desc: "Workspace → Production → DPR Report. Date-based report of all production activity. Two modes: Daily (one date, stage breakdown) and Weekly (7-day trend).",
				link: "/app/ib-dpr", linkLabel: "Open DPR",
				tags: "dpr daily weekly production report kpi stage breakdown machine operator output wastage efficiency hours shift",
				steps: [
					"Go to <b>Workspace → Production → DPR Report</b>.",
					"<b>Toolbar:</b> Date picker (defaults today), Daily/Weekly toggle buttons, Refresh button.",
					"<b>Daily mode — 5 KPI cards:</b> WOs Completed, Total Entries, Total Output, Avg Wastage %, Total Hours.",
					"<b>WO Completion Notice:</b> if WOs were completed today, shows count + stage-coloured breakdown chips.",
					"<b>Stage Breakdown table:</b> Stage name, Entries, Input Qty, Output Qty (with efficiency bar), Wastage Qty, Wastage % (red >5%, orange 2–5%), Hours, Hourly Avg.",
					"<b>ABOVE NORM badge:</b> appears in wastage column if any machine exceeded its wastage_norm_pct.",
					"<b>Click a stage row</b> to expand machine-level subtable: Machine, Entries, Output, Wastage % (with ABOVE NORM), Status.",
					"<b>Weekly mode — 3 KPI cards:</b> Total Output (Week), Avg Daily Output, Avg Wastage %.",
					"<b>Daily Breakdown table (weekly):</b> Date, Entries, Input, Output (with bar chart), Wastage %, Hours.",
				],
				tip: "Use Daily mode for shift handover reviews. Use Weekly mode for manager-level production trend reviews.",
			},
			{
				num: "PROD-16", title: "Auto Order Sheet Scheduler — Priority Derivation",
				desc: "Daily midnight scheduler scans all submitted Sales Orders without an Order Sheet and auto-creates them. Priority set automatically based on delivery date urgency.",
				tags: "auto scheduler order sheet midnight daily priority urgent high normal low delivery date automatic create",
				steps: [
					"Runs automatically every night (scheduled via Frappe scheduler: run_daily_production_snapshot).",
					"Finds submitted SOs with no linked IB Order Sheet.",
					"Creates Order Sheet for each. Sets priority by days until delivery_date from SO:",
					"  → ≤ 2 days: <b>Urgent</b>",
					"  → ≤ 5 days: <b>High</b>",
					"  → ≤ 10 days: <b>Normal</b>",
					"  → > 10 days (or no delivery date): <b>Low</b>",
					"WOs are auto-created per stage per item based on item group routing.",
					"n8n webhook fires for each newly created Order Sheet.",
				],
				note: "The scheduler is a safety net — manual creation from the SO or Order-wise tab is preferred when production needs to start immediately.",
			},
			{
				num: "PROD-17", title: "RTD Bell Notification to Sales Person",
				desc: "When all items in an Order Sheet reach Ready to Deliver stage, a bell notification is automatically sent to the Sales Person assigned to that Sales Order.",
				tags: "rtd ready to deliver bell notification sales person order sheet all items completed automatic",
				steps: [
					"Production marks the last Packing WO as Complete.",
					"System advances WO to Ready to Deliver stage.",
					"Instabiz checks: are all items in this Order Sheet at RTD or later?",
					"If yes: Frappe bell notification sent to the linked SO's sales person (user).",
					"Notification message: '<customer> order ready to deliver' with link to the Order Sheet.",
					"Sales person sees the bell icon light up in the toolbar.",
				],
				note: "Notification sends only once per Order Sheet — when the last item crosses RTD. Handled by on_work_order_update_notify() in production.py.",
			},
			{
				num: "PROD-18", title: "SO List Production Badges",
				desc: "The Sales Order list view shows a production status badge for each SO that has an Order Sheet. Updates in real time as Work Orders advance.",
				tags: "so sales order list production badge status not started in production ready to deliver dispatched in transit delivered",
				steps: [
					"Open <b>Sales Order list</b> from any workspace.",
					"Each SO row shows a colored production badge (if an Order Sheet exists):",
					"  → <b>Not Started</b> (grey) — Order Sheet created, no WOs started.",
					"  → <b>In Production</b> (blue) — at least one WO In Progress.",
					"  → <b>Ready to Deliver</b> (orange) — all items at RTD stage.",
					"  → <b>Dispatched</b> (purple) — Delivery Note submitted against this SO.",
					"  → <b>In Transit</b> (teal) — DN submitted with shipping tracking.",
					"  → <b>Delivered</b> (green) — DN delivered/closed.",
				],
			},
			{
				num: "PROD-19", title: "AI Production Agents",
				desc: "5 AI agents monitor production and surface actions in the AI Inbox and Production Dashboard panel. Each action requires manual Approve or Reject.",
				link: "/app/ib-ai-inbox", linkLabel: "AI Inbox",
				tags: "ai production agents prod_advance prod_machine_assign prod_notify_ready prod_auto_os prod_job_bundle approve reject inbox",
				steps: [
					"<b>prod_advance</b> — suggests advancing a WO to next stage when completed_qty ≥ target_qty.",
					"<b>prod_machine_assign</b> — recommends machine assignment for Pending WOs using load-balanced logic.",
					"<b>prod_notify_ready</b> — flags when all items in an Order Sheet have reached RTD (used to send the bell notification).",
					"<b>prod_auto_os</b> — suggests creating Order Sheets for SOs that have been submitted but not yet planned.",
					"<b>prod_job_bundle</b> — identifies Pending WOs that can be batch-assigned for efficiency (same item + stage).",
					"View pending actions: AI Inbox → filter Status = Pending + agent = prod_*. Or: Production Dashboard → AI Production Actions panel.",
					"Click <b>Approve</b> to execute. Click <b>Reject</b> to dismiss. Both are logged with user and timestamp.",
				],
			},
			{
				num: "PROD-20", title: "n8n Webhook Integration — Production Triggers",
				desc: "n8n runs locally on the same server as Frappe (http://localhost:5678, PM2-managed). Frappe fires webhooks to n8n on key production events; n8n workflows can call back into Frappe's REST API to act on the data.",
				tags: "n8n webhook integration work order order sheet update creation workflow trigger production automation config",
				steps: [
					"<b>Config keys (sites/frontend/site_config.json):</b> <code>n8n_webhook_url</code> — n8n's Webhook node production URL, e.g. <code>http://localhost:5678/webhook/&lt;path&gt;</code>. Blank = webhooks silently skip (fire-and-forget, 5s timeout, logs to Error Log on failure).",
					"<b>Events fired</b> (instabiz/overrides/n8n_hooks.py, wired via doc_events in hooks.py): <code>work_order_started</code>, <code>work_order_stage_completed</code>, <code>work_order_rtd</code>, <code>work_order_updated</code> (all from IB Work Order on_update) and <code>order_sheet_created</code> / <code>order_sheet_completed</code> (from IB Order Sheet).",
					"<b>Payload shape:</b> <code>{ event, payload: {...doc fields...}, site }</code> — sent via <code>notify_n8n(event, payload)</code> in ai_agents.py.",
					"<b>Build a workflow in n8n:</b> add a <b>Webhook</b> node (POST, responseMode = <i>responseNode</i> if you add an explicit Respond node), branch on <code>$json.body.event</code>, call back into Frappe with an <b>HTTP Request</b> node.",
					"<b>Auth for the callback:</b> create a dedicated Frappe service user (e.g. <code>n8n-automation@instabiz.local</code>) with only the roles it needs (Factory Production for read/write on IB Work Order; add a Manager role like Manufacturing Manager only if it must call agent-approval endpoints). Generate api_key/api_secret on that user, then in n8n create an <b>HTTP Header Auth</b> credential: header <code>Authorization</code>, value <code>token &lt;api_key&gt;:&lt;api_secret&gt;</code>. Never use the Administrator account for this.",
					"<b>Same-host rule:</b> n8n and Frappe run on the same box — HTTP Request nodes should call <code>http://localhost:8000/api/...</code>, not the public tunnel domain. The public URL (e.g. Cloudflare tunnel to instabizdev.qzz.io) only matters for browser/external traffic into Frappe; it is not needed for n8n↔Frappe calls and adds an unnecessary external hop.",
					"Activate the workflow (POST <code>/api/v1/workflows/{id}/activate</code> via n8n's REST API, or the UI toggle) — inactive workflows will 404 on their production webhook path.",
					"Test end-to-end: trigger a real doc save (e.g. update an IB Work Order's status) and check n8n's execution list, or use the n8n Console page (see PROD-22) which surfaces recent executions and webhook errors inline.",
				],
				note: "Webhook POSTs are fire-and-forget from Frappe's side (5s timeout) — a slow or down n8n never blocks the save. Keep n8n workflow logic itself fast; long-running processing should hand off to a queue/sub-workflow rather than blocking the webhook response.",
			},
			{
				num: "PROD-21", title: "End-to-End Production Workflow",
				desc: "Complete step-by-step from Sales Order to dispatch through the full production system.",
				tags: "end to end workflow complete so order sheet work order dispatch full cycle",
				steps: [
					"<b>1.</b> Sales team submits Sales Order.",
					"<b>2.</b> Production team opens SO → clicks <b>Create Order Sheet</b> (or auto-scheduler creates it at midnight).",
					"<b>3.</b> Order Sheet created. Priority and WOs auto-assigned based on item group.",
					"<b>4.</b> Open <b>Production Stages → Pipeline</b>. WOs appear in first applicable stage column.",
					"<b>5.</b> Click <b>Assign Machine</b> in the side panel for each WO. Or use Job Bundles tab to batch-assign.",
					"<b>6.</b> Click <b>Start</b> on the WO. For Coating/Slitting: link a Jumbo Roll.",
					"<b>7.</b> Log production entries during the shift (<b>+ New Entry</b> in the side panel).",
					"<b>8.</b> Click <b>Complete</b>. Enter completed_qty and wastage_qty.",
					"<b>9.</b> System auto-creates the next-stage WO. Repeat Start → Log → Complete for each stage.",
					"<b>10.</b> After Packing WO completes → WO moves to Ready to Deliver. Bell notification sent to sales person.",
					"<b>11.</b> Sales creates Delivery Note from the SO. Production badge on SO → Dispatched → Delivered.",
					"<b>12.</b> End-of-day: review <b>DPR</b> (Daily mode) for wastage vs. norm per stage and machine.",
				],
			},
			{
				num: "PROD-22", title: "n8n Console — Workflow Monitor and Control",
				desc: "Workspace shortcut, n8n Console (System Manager only). Proxies n8n's REST API so you can see workflow/execution health without leaving Frappe.",
				link: "/app/ib-n8n-console", linkLabel: "n8n Console",
				tags: "n8n console monitor workflows executions api key status webhook errors toggle",
				steps: [
					"<b>Config keys:</b> <code>n8n_base_url</code> (defaults to <code>http://localhost:5678</code> if unset), <code>n8n_api_key</code> (n8n API key — n8n UI → Settings → API → create one, or via n8n's REST API), <code>n8n_webhook_url</code> (see PROD-20).",
					"Console shows: online/offline status (n8n <code>/healthz</code>), full workflow list (id, name, active flag, trigger type, node count), recent executions (status, mode, timestamps), and recent webhook failures pulled from Frappe's Error Log (method LIKE '%n8n%').",
					"<b>Activate/Deactivate</b> a workflow directly from the console (System Manager only) — calls n8n's <code>/api/v1/workflows/{id}/activate|deactivate</code>.",
					"Click an execution to drill into full input/output data per node (useful for debugging a failed callback).",
					"If the console shows \"API key invalid or not set\": add/update <code>n8n_api_key</code> in site_config.json, then <code>bench --site frontend clear-cache</code> — no restart needed, config is read live per request.",
				],
				note: "n8n_api_key (console monitoring) and the per-user api_key/api_secret used for callback auth (PROD-20) are two separate credentials serving two different directions of the integration — don't confuse them.",
			},
			{
				num: "PROD-23", title: "Automation Testing Guide — Wiring an Agent Action Through n8n",
				desc: "How to prove an n8n workflow can drive a real Instabiz AI agent action end-to-end using nothing but HTTP calls (curl/POST) against Frappe's whitelisted API — no custom n8n node code required.",
				tags: "automation testing guide n8n agent istix_enforcer run_agent approve_action curl post whitelisted api dummy test",
				steps: [
					"<b>Why this pattern:</b> the 6 AI agents (feature 89) are human-in-the-loop by design — an agent run only queues a draft <code>IB AI Action</code>; nothing happens to real data until a manager approves it. n8n can legitimately stand in for that manager by calling the same whitelisted endpoints a human would trigger from the AI Inbox UI — it does not bypass the approval step, it performs it.",
					"<b>Chain:</b> POST <code>/api/method/instabiz.overrides.ai_agents.run_agent</code> with <code>{agent_code: '&lt;code&gt;'}</code> → GET <code>/api/method/instabiz.overrides.ai_agents.get_ai_actions?status=pending&agent=&lt;code&gt;</code> → match the row by <code>reference_name</code> → POST <code>/api/method/instabiz.overrides.ai_agents.approve_action</code> with <code>{name: '&lt;action name&gt;'}</code> → verify the resulting side-effect (e.g. GET <code>/api/resource/Notification Log</code> filtered by <code>document_name</code>).",
					"<b>Auth:</b> <code>run_agent</code> / <code>approve_action</code> / <code>get_ai_actions</code> all require one of System Manager, Sales Manager, Accounts Manager, HR Manager, Purchase Manager, or Manufacturing Manager on the calling user (see <code>_ALL_MANAGER_ROLES</code> in ai_agents.py) — the plain read-only service user from PROD-20 is not enough for this chain.",
					"<b>Always test against a disposable record</b>, never live data: e.g. for <code>istix_enforcer</code> (stalled Work Order escalation), insert a throwaway IB Work Order with <code>status='In Progress'</code> and <code>started_at</code> backdated 9+ hours so it trips the &gt;=8h stalled condition, run the chain, confirm the Notification Log fired, then delete the dummy Work Order, its IB AI Action row, and the Notification Log row it produced. <code>IB Agent Run Log</code> rows from the test run are harmless history and don't need cleanup.",
					"Build the n8n side as: <b>Webhook</b> node (manual test trigger, POST) → <b>HTTP Request</b> (run_agent) → <b>HTTP Request</b> (get_ai_actions) → <b>Code</b> node to pick the matching action → <b>HTTP Request</b> (approve_action) → <b>HTTP Request</b> (verify). All HTTP Request nodes use the same HTTP Header Auth credential described in PROD-20.",
					"This same pattern generalizes to any agent: swap <code>agent_code</code> and the verification query for the agent's actual side-effect (smart_reorder → check Material Request created; collections → check WhatsApp log; prod_notify_ready → check Notification Log for the sales person).",
				],
				note: "Claude-dependent agents (auto_quote, collections, demand_forecast, etc.) still run and queue actions even with no Anthropic credit balance — llm.py falls back to a deterministic message when the Claude call fails, so the test chain works whether or not the API key has credit.",
			},
		],
	},
	{
		id: "banking", cat: "finance",
		icon: '<iconify-icon icon="lucide:landmark" width="17" height="17"></iconify-icon>', color: "#e8f5e9", iconColor: "#1a7f37",
		title: "Finance and Banking",
		roles: _FINANCE,
		items: [
			{
				num: "79", title: "Bank Statement Import",
				desc: "Workspace, Finance, Bank Import. Upload HDFC NetBanking CSV. Preview rows, then import to create Bank Transaction records (Unreconciled).",
				link: "/app/ib-bank-statement-import", linkLabel: "Bank Import",
				tags: "bank statement import hdfc csv reconcile",
				steps: [
					"Download HDFC CSV from NetBanking portal.",
					"Go to <b>Workspace, Finance, Bank Import</b>.",
					"Drag-and-drop or upload the CSV file.",
					"Preview parsed rows with deposit and withdrawal summary.",
					"Click Import. Duplicate rows are auto-skipped.",
					"Go to <b>Accounts, Bank Reconciliation Tool</b> to match transactions to Payment Entries.",
				],
			},
			{
				num: "75", title: "IB Bank Reconciliation Report",
				desc: "Reports, IB Bank Reconciliation. Payment Entries for IB bank accounts with clearance status (Cleared / Uncleared). Shows entries pending 7+ days.",
				link: "/app/query-report/IB Bank Reconciliation", linkLabel: "View Report",
				tags: "bank reconciliation report cleared uncleared",
			},
			{
				num: "74", title: "Bank Accounts",
				desc: "Two HDFC accounts: GUJARAT and MAHARASHTRA (A/c 50200023672503, IFSC HDFC0000627) and CHENNAI (A/c 50200044619421). Default is the MH and GJ account.",
				tags: "bank account hdfc ifsc account number",
			},
			{
				num: "59", title: "IB AP Aging Report",
				desc: "Outstanding Purchase Invoices bucketed into 0-30, 31-60, 61-90, 90+ days overdue. Bar chart. Summary cards: count, unique suppliers, total payable, 90+ value. Filter by supplier.",
				link: "/app/query-report/IB AP Aging", linkLabel: "View Report",
				tags: "ap aging purchase invoice outstanding payable supplier overdue",
				note: "Use alongside IB AR Aging for a complete picture of receivables vs payables. 90+ bucket is color-coded red.",
			},
			{
				num: "COL-1", title: "Collections Dashboard",
				desc: "Live outstanding receivables dashboard for Sales and Accounts teams. Shows per-customer summary: outstanding amount, advance payments, net outstanding, oldest invoice, and last 90-day collection trend. Filter by sales rep, search by customer name, or toggle Overdue Only. Privileged users (Sales Manager, Accounts) see all reps; Sales User sees only their own customers.",
				link: "/app/ib-collections-dashboard", linkLabel: "Collections Dashboard",
				tags: "collections dashboard outstanding receivables advance overdue customer rep filter search 90 days",
				steps: [
					"Go to <b>Workspace → Finance → Collections Dashboard</b> (or navigate to /app/ib-collections-dashboard).",
					"Default view: all outstanding invoices for your customers. Toggle <b>Overdue Only</b> to show only invoices past due date.",
					"<b>Search</b> by customer name or invoice number.",
					"<b>Sales Managers and Accounts users</b>: use the Rep filter dropdown to view any rep's portfolio.",
					"Each customer row shows: invoice count, outstanding, advance (unallocated payment), net outstanding, oldest due date.",
					"Click a customer row to expand the invoice drill-down (all unpaid invoices for that customer with days overdue).",
					"KPI cards at top: Total Outstanding, Total Advance, Net Outstanding, Customer Count, Overdue Count, Collected Last 90 Days.",
				],
				note: "Advance shown = unallocated Payment Entries (Receive type, party=Customer). Net Outstanding = Outstanding − Advance.",
			},
		],
	},
	{
		id: "targets", cat: "sales",
		icon: '<iconify-icon icon="lucide:trophy" width="17" height="17"></iconify-icon>', color: "#fff8e0", iconColor: "#b8860b",
		title: "Sales Targets and Performance Monitoring",
		roles: _MANAGERS,
		items: [
			{
				num: "14", title: "Setting Monthly Sales Targets",
				desc: "Sales Managers create a monthly revenue target per rep using IB Sales Target (IB-ST-.YYYY.-#####). The rep sees their target card on the Customer Board. Scheduler sends bell alerts at 50% and 75% month elapsed if behind pace, and at month-end if target not met.",
				link: "/app/ib-sales-target", linkLabel: "Sales Targets",
				tags: "sales target monthly revenue rep user manager set bell alert pace",
				steps: [
					"Go to <b>IB Sales Target → New</b> (Sales Manager or System Manager only).",
					"Select <b>Sales User</b> and <b>Month</b> (system normalizes to first of month).",
					"Enter <b>Target Amount</b> (currency).",
					"Save. One target per user per month — duplicates are rejected.",
					"The rep's Customer Board page shows a target card with progress for the current month.",
					"Assignment Admin roster shows a sales target bar per user.",
				],
				note: "Sales User can read their own target but cannot create or edit it. Sales Manager and above can create and edit all targets.",
			},
			{
				num: "15", title: "Customer Health Score",
				desc: "Daily scheduler auto-computes a 0–100 health score per active customer: payment punctuality (35%), order frequency (30%), complaint count (20%), CSAT rating (15%). Status: Green ≥70, Amber ≥40, Red <40. If a customer's score drops 15+ points, all Sales Managers get an email alert.",
				link: "/app/ib-customer-score", linkLabel: "Customer Score List",
				tags: "customer health score green amber red payment frequency complaint csat drop alert email daily",
				steps: [
					"Score is computed automatically every night — no manual action needed.",
					"View scores via <b>Workspace → Sales & CRM → Customer Health</b>.",
					"Each IB Customer Score record stores: score_date, health_status, total_score, previous_score, score_change, and component scores.",
					"If score drops 15+ points in a day, an email is sent to all Sales Manager and System Manager users.",
				],
				tip: "Use Customer Health to prioritize outreach. Red = at risk of churn. Amber = needs attention. Green = healthy.",
			},
			{
				num: "13", title: "Dormant Customer Detection",
				desc: "Daily scheduler: customers with no submitted Sales Order in 60+ days get a ToDo assigned to their sales rep, plus a bell notification with a WhatsApp wa.me deep-link for quick contact. One alert per customer (deduplicated via [ib-dormant-reminder] marker in the ToDo description).",
				tags: "dormant customer 60 days no order alert todo whatsapp wa link re-engage",
				note: "The dormant threshold matches IB Assignment Config's dormant_threshold_days setting. The alert includes a wa.me link so the rep can message the customer directly with one click.",
			},
			{
				num: "21", title: "Fulfillment SLA Alert (48-Hour)",
				desc: "Daily scheduler: submitted Sales Orders with no linked submitted Delivery Note after 48 hours trigger a bell notification to the assigned sales rep. Ensures timely dispatch. One alert per SO (deduplicated via [ib-sla-alert] marker in the Notification Log subject).",
				tags: "fulfillment sla alert 48h dispatch delivery note no dn overdue",
				note: "Alert fires once per SO and is not repeated daily. Once a DN is submitted against the SO, future runs skip it.",
			},
			{
				num: "22b", title: "Win-Back Nudges for Stale Opportunities",
				desc: "Daily scheduler sends win-back alerts for: (1) Open/Replied Quotations with no activity in 14+ days → alert to the sales rep. (2) Leads in Cold, Contacted, or Warm status with no activity in 30+ days → alert to lead_owner. Re-alerts every 14 days as long as the document stays stale.",
				tags: "win back nudge stale quotation lead cold warm contacted no activity dormant alert bell repeat",
				note: "Activity measured by last modified timestamp. Alerts repeat every 14 days — if a quotation stays Open for a month, the rep gets two nudges. Win-back and dormant customer alerts are separate.",
			},
		],
	},
	{
		id: "dashboards", cat: "dashboard",
		icon: '<iconify-icon icon="lucide:layout-dashboard" width="17" height="17"></iconify-icon>', color: "#fef6f2", iconColor: "#d97757",
		title: "Dashboards",
		roles: ["Sales Manager", "Accounts User", "System Manager", "Purchase Manager", "HR Manager"],
		items: [
			{
				num: "DASH-1", title: "Main Dashboard (Business Pulse)",
				desc: "Top-level business overview: Revenue MTD, Outstanding AR, Open Quotations, Low/Zero Stock count. Revenue Trend 6-month chart. Top Customers bar chart. Recent Invoices table. All KPI cards are clickable deep-links.",
				link: "/app/ib-main-dashboard", linkLabel: "Open Dashboard",
				tags: "main dashboard business pulse revenue ar quotation stock kpi trend top customers invoices",
				steps: [
					"Go to <b>Workspace → Dashboards → Dashboard</b> (Business Pulse).",
					"4 KPI cards: <b>Revenue MTD</b> (→ SI list), <b>Outstanding AR</b> (→ unpaid SI list), <b>Open Quotations</b> (→ Quotation list), <b>Low/Zero Stock</b> (→ Stock Dashboard).",
					"Revenue Trend chart shows 6-month monthly revenue (bar chart).",
					"Top Customers bar shows top 10 by monthly order value.",
					"Recent Invoices table shows last 10 submitted SIs with status badges.",
					"Click any KPI card to open the filtered document list.",
				],
				tip: "Best used as a morning quick-check for Sales Managers and System Managers.",
			},
			{
				num: "DASH-2", title: "Finance Dashboard",
				desc: "6 KPI cards: Revenue MTD, Gross Profit MTD, Outstanding AR, Cash & Bank, Expenses MTD, Revenue YTD. P&L trend chart. Top Vendors bar. GST Summary. Cash/Bank Balances. Overdue Receivables table.",
				link: "/app/ib-finance-dashboard", linkLabel: "Finance Dashboard",
				tags: "finance dashboard revenue gross profit ar ap cash gst overdue receivables vendors expense ytd",
				steps: [
					"Go to <b>Workspace → Dashboards → Finance Dashboard</b>.",
					"6 KPI cards: Revenue MTD (→ SI list), Gross Profit MTD (→ Gross Margin report), Outstanding AR (→ unpaid SI list), Cash & Bank (→ Bank Account list), Expenses MTD (→ PI list), Revenue YTD (→ SI list).",
					"P&L trend chart (6-month). Top Vendors bar chart.",
					"GST Summary section shows current month GST liability estimate.",
					"Cash/Bank Balances section shows HDFC MH+GJ and Chennai balances.",
					"Overdue Receivables table: SIs past due date with outstanding amount.",
				],
			},
			{
				num: "DASH-3", title: "HR Dashboard",
				desc: "4 KPI cards: Active Employees, Present Today, Pending Leaves, Payroll MTD. Tabs: Attendance, Leaves, Payroll, Statutory. Approve/reject leaves inline. Department headcount bars.",
				link: "/app/ib-hrms-dashboard", linkLabel: "HR Dashboard",
				tags: "hr dashboard employees attendance leaves payroll statutory approve reject department headcount",
				steps: [
					"Go to <b>Workspace → Dashboards → HR Dashboard</b>.",
					"4 KPI cards: <b>Active Employees</b> (→ Employee list), <b>Present Today</b> (→ today's Attendance list), <b>Pending Leaves</b> (→ Leave Application list), <b>Payroll MTD</b> (→ Salary Slip list).",
					"<b>Attendance tab</b>: Department headcount bars. Today's present/absent/late count by shift.",
					"<b>Leaves tab</b>: Pending Leave Applications with inline Approve / Reject buttons.",
					"<b>Payroll tab</b>: Salary slip status this month (Draft/Submitted count).",
					"<b>Statutory tab</b>: PF, ESIC, PT deduction totals for current payroll month.",
				],
				tip: "Use the Leaves tab for quick leave approvals without opening each Leave Application individually.",
			},
			{
				num: "DASH-4", title: "Procurement Dashboard",
				desc: "5 KPI cards: Open POs, Pending GRN, Spend MTD, Overdue AP, Draft Bills. All deep-linked to filtered document lists. Top Suppliers bar chart. Recent POs table.",
				link: "/app/ib-procurement-dashboard", linkLabel: "Procurement Dashboard",
				tags: "procurement dashboard po grn spend ap bills suppliers overdue draft receipt",
				steps: [
					"Go to <b>Workspace → Dashboards → Procurement Dashboard</b>.",
					"5 KPI cards: <b>Open POs</b> (→ submitted PO list), <b>Pending GRN</b> (→ submitted GRN list), <b>Spend MTD</b> (→ submitted PI list), <b>Overdue AP</b> (→ overdue PI list), <b>Draft Bills</b> (→ draft PI list).",
					"Top Suppliers bar chart shows top 10 by MTD spend.",
					"Recent POs table lists last 10 submitted POs with receipt + billing status.",
					"Click any KPI card to drill into the filtered document list.",
				],
			},
			{
				num: "DASH-5", title: "Production Dashboard KPIs and Deep Links",
				desc: "4 KPI cards: Active WOs, Pending WOs, Completed Today, Machines Active. All clickable deep-links. Stage pipeline shows counts per stage. Priority strip, wastage card, active plan table.",
				link: "/app/ib-production-dashboard", linkLabel: "Production Dashboard",
				tags: "production dashboard wo stage kpi machines active pending completed wastage priority plan order sheet",
				steps: [
					"Go to <b>Workspace → Production → Production Dashboard</b>.",
					"4 KPI cards: <b>Active WOs</b> (→ IB Work Order list In Progress), <b>Pending</b> (→ Pending WOs), <b>Completed Today</b> (→ WOs completed today), <b>Machines Active</b> (→ IB Machine list Active).",
					"Stage pipeline shows work order count per stage (Coating→Slitting→Rewinding→Cutting→Packing→RTD→Delivered). Click any stage → opens Production Stages kanban for that stage.",
					"Priority strip shows Urgent/High/Normal/Low WO counts.",
					"Wastage card shows today's average wastage %.",
					"Active Plan table lists all active Order Sheets with item count and status.",
				],
			},
			{
				num: "DASH-6", title: "Analytics Hub",
				desc: "Cross-module analytics: Revenue trend, Collections trend, Margin trend, Top items, Top territories, AI agent summary, and recent AI actions. Combines sales, finance, production, and HR data in one view.",
				link: "/app/ib-main-dashboard", linkLabel: "Analytics Hub",
				tags: "analytics hub cross module revenue collection margin trend top items territory ai summary",
				steps: [
					"Go to <b>Workspace → Dashboards → Analytics Hub</b>.",
					"Revenue, Collections, and Margin trend charts (6-month each).",
					"Top Items and Top Territories bar charts from submitted SOs.",
					"AI Agent Summary shows pending actions count by agent category.",
					"Use this for weekly review meetings — single page covering all dimensions.",
				],
				tip: "All dashboards auto-refresh every 5 minutes when open. KPI numbers animate with count-up effect on load. Skeleton cards appear while loading.",
			},
		],
	},
];

const KB_WORKFLOWS = {
	lead: {
		title: "Lead / Customer — Starting the Sales Process",
		body: `
<p>Start with a <b>Lead</b> (prospect) or an existing <b>Customer</b>.</p>
<ul class="ib-kb-steps">
  <li>Create Lead: CRM, Lead, New. Enter name, mobile, email, territory.</li>
  <li>Enter Pincode — city and district auto-fill from India Post API.</li>
  <li>Lead is auto-assigned to a sales rep via round-robin (based on territory).</li>
  <li>Log activities: Call, Meeting, WhatsApp, Email, Visit with outcome and next follow-up date.</li>
  <li>When ready: Lead, Make, Customer (custom mapper carries territory, pincode, sales person).</li>
</ul>
<div class="ib-kb-tip">Lead Score (0-100) is auto-computed from temperature, status, and contact completeness. Leads with score above 30 and product interest set get AI auto-quote suggestions.</div>`,
	},
	quotation: {
		title: "Quotation — Sending a Price Quote",
		body: `
<ul class="ib-kb-steps">
  <li>Go to Quotation, New. Set Location (Maharashtra / Gujarat / Chennai).</li>
  <li>Select Quotation To: Customer or Lead.</li>
  <li>Add items with dimensions. Qty auto-calculates from width x length x qty_pkg x total_pkg.</li>
  <li>Rate auto-applies from Pricing Rules (rate contract) if configured.</li>
  <li>GST template auto-selected (In-state / Out-state) based on GSTINs.</li>
  <li>Floor price check: rep blocked if below cost plus min margin (manager gets a warning).</li>
  <li>Submit when ready to send to customer.</li>
</ul>
<div class="ib-kb-note">Quotations are valid for 1 month. Daily alerts at 15, 7, and 1 day before expiry. Auto-expired past valid_till date.</div>`,
	},
	so: {
		title: "Sales Order — Confirming the Order",
		body: `
<ul class="ib-kb-steps">
  <li>Open submitted Quotation, Make, Sales Order.</li>
  <li>All dimensions, custom fields, address, and transport fields are auto-carried.</li>
  <li>Review and adjust if needed. Submit.</li>
  <li>On SO submit: assignment is marked done if customer was in daily board. Stock update broadcast fires.</li>
</ul>
<div class="ib-kb-note">SO submit is blocked if: (1) outstanding exceeds credit limit AND oldest invoice is past allowed days; OR (2) customer has the 30-day overdue block flag set.</div>
<div class="ib-kb-tip">Advance payments: create Payment Entry with Reference DocType = Sales Order before raising the invoice. The SO shows Advance Received automatically.</div>`,
	},
	dn: {
		title: "Delivery Note — Dispatching the Goods",
		body: `
<ul class="ib-kb-steps">
  <li>Open submitted Sales Order, Make, Delivery Note.</li>
  <li>Warehouse auto-set from location. Item dimensions pre-filled.</li>
  <li>Enter LR Number (custom_lr_number) and Transporter.</li>
  <li>System checks actual stock. If short: draft Stock Reconciliation is auto-created — submit it first, then re-submit DN.</li>
  <li>On DN submit: E-Way Bill auto-generates (if API configured). Sales person gets a bell notification with LR details.</li>
</ul>
<div class="ib-kb-tip">The IB Packing List print format shows rolls per box, carton weight, carton marking, LR number, and three signature lines.</div>`,
	},
	si: {
		title: "Sales Invoice — Billing the Customer",
		body: `
<ul class="ib-kb-steps">
  <li>Open submitted Delivery Note, Make, Sales Invoice.</li>
  <li>SI inherits the same number as the DN (DC-00005 becomes INV-00005).</li>
  <li>Optional: enter Transport Charges — GST on transport is auto-calculated per GST row rate.</li>
  <li>Submit. Then click <b>Generate e-Invoice</b> button to create the IRN from the NIC portal.</li>
  <li>Print using IB Tax Invoice format: 2-page output with IRN / QR code and E-Way Bill.</li>
</ul>
<div class="ib-kb-note">SI cancellation requires a Cancellation Reason. Credit Notes (returns) get a separate CN naming series.</div>`,
	},
	payment: {
		title: "Payment Entry — Recording the Collection",
		body: `
<ul class="ib-kb-steps">
  <li>Open submitted Sales Invoice, Make, Payment Entry (simplest path).</li>
  <li>Or go to Accounts, Payment Entry, New for a standalone entry.</li>
  <li>Set Payment Type = Receive, Party Type = Customer, Amount Received, Reference No.</li>
  <li>If Payment References are empty on submit: system auto-links to oldest outstanding Sales Invoices (FIFO).</li>
  <li>Submit. Accounts roles get a bell notification.</li>
</ul>
<div class="ib-kb-tip">Attaching payment screenshot: open the SI or SO, go to the bottom Attachments section, Add Attachment, Upload File or drag-and-drop.</div>
<div class="ib-kb-note">For PDC tracking: use IB PDC doctype. Alert fires 3 days before the cheque date.</div>`,
	},
};

// ── Search config ─────────────────────────────────────────────────────────────

const TYPO_MAP = {
	quatation: "quotation", quotaion: "quotation", quatotion: "quotation",
	invocie: "invoice", invoie: "invoice", invioce: "invoice",
	paymnet: "payment", payemnt: "payment", payement: "payment",
	delievry: "delivery", deliery: "delivery", dilievery: "delivery",
	cusotmer: "customer", custoemr: "customer", cutsomer: "customer",
	reprot: "report", repot: "report",
	stcok: "stock", stosk: "stock",
	einvoice: "e-invoice irn", eway: "e-way bill ewb", irn: "e-invoice irn",
	waybill: "e-way bill ewb", "e-waybill": "e-way bill ewb",
	"credit note": "credit note cn return",
	pdc: "post dated cheque pdc bank",
	fnf: "full final settlement",
	hr: "hr employee attendance payroll",
	crm: "crm lead customer prospect",
	gst: "gst tax gstin invoice",
	sla: "fulfillment sla alert 48h dispatch",
	kanban: "customer board kanban",
	ot: "overtime request hours",
	scorecard: "customer health score green amber red",
	"lead team": "lead sales team round robin assignment",
	sample: "sample request dispatch feedback",
	roster: "assignment admin roster manager",
	wo: "work order stage machine production",
	os: "order sheet production plan so",
	dpr: "daily production report stage output wastage",
	jr: "jumbo roll raw material batch traceability",
	rtd: "ready to deliver stage production notification",
	prod: "production stage work order machine",
	coating: "coating stage production jumbo roll",
	slitting: "slitting stage production",
	packing: "packing stage production qc",
	wos: "work order stage machine production",
	inbox: "ai inbox approve reject pending",
	autoquote: "auto quote agent lead suggestion",
	reorder: "smart reorder material request low stock",
	dunning: "collections agent overdue invoice whatsapp",
};


const SYNONYMS = {
	invoice: ["si", "bill", "billing"],
	quotation: ["quote", "estimate"],
	delivery: ["dn", "dispatch", "shipment"],
	payment: ["pe", "collection", "receipt", "money"],
	"credit note": ["cn", "return", "refund"],
	"e-invoice": ["irn", "gst invoice"],
	"e-way bill": ["ewb", "eway", "transport"],
	attendance: ["checkin", "absent", "leave"],
	payroll: ["salary", "slip", "pf", "esic"],
	stock: ["inventory", "warehouse", "qty", "bin"],
	lead: ["prospect", "crm"],
	report: ["analytics", "dashboard", "kpi"],
	whatsapp: ["wa", "message", "broadcast"],
	"customer board": ["kanban", "daily plan", "assignment"],
	"sample request": ["sample", "trial", "demo"],
	"sales team": ["round robin", "assignment team", "territory team"],
	target: ["goal", "quota", "monthly target"],
	dormant: ["inactive", "no order", "lapsed", "re-engage"],
	"health score": ["customer score", "health", "green amber red"],
	"overtime": ["ot", "extra hours", "overtime request"],
	"rate contract": ["pricing rule", "customer rate", "special price", "contract price"],
	"packing list": ["packing", "carton", "rolls per box"],
	"org chart": ["organization chart", "reporting structure", "hierarchy"],
	assignment: ["roster", "pool", "daily assign"],
	"work order": ["wo", "stage", "production task"],
	"order sheet": ["os", "production plan", "order plan"],
	"jumbo roll": ["jr", "raw roll", "raw material batch"],
	"production stages": ["pipeline", "kanban", "prod stages"],
	"job bundle": ["batch assign", "bundle", "group assign"],
	"machine assign": ["load balance", "machine assignment", "assign machine"],
	"ai inbox": ["inbox", "approve action", "reject action"],
	"auto quote": ["auto_quote", "lead suggestion", "quote agent"],
	"collections agent": ["dunning", "overdue message", "collections"],
	"demand forecast": ["demand_forecast", "sku forecast", "4 week forecast"],
	"smart reorder": ["smart_reorder", "reorder agent", "material request agent"],
	"buying dna": ["buying_dna", "customer followup", "repeat customer"],
	"wastage": ["waste", "wastage pct", "waste norm"],
};

// ── Setup ─────────────────────────────────────────────────────────────────────

function _setup_kb(wrapper, user_roles) {
	user_roles = user_roles || new Set(frappe.boot.user.roles || []);
	const $w = $(wrapper);

	const visible = KB_SECTIONS.filter(s =>
		!s.roles || !s.roles.length || s.roles.some(r => user_roles.has(r))
	);

	// Build flat search index
	const _index = [];
	visible.forEach(sec => {
		sec.items.forEach(item => {
			const blob = [
				item.title,
				item.desc || "",
				(item.steps || []).join(" "),
				item.note || "",
				item.tip || "",
				item.tags || "",
				sec.title,
			].join(" ").toLowerCase();
			_index.push({ sec, item, blob });
		});
	});

	// Update hero stat
	$w.find("#ib-kb-stat-articles").text(`${_index.length} articles`);

	_render_cats($w, visible);
	_render_sections($w, visible, _index);
	_render_recent($w, _index);
	_setup_search($w, _index, visible);
	_setup_workflow($w);
	_setup_keyboard($w);
	_setup_more_toggle($w);
	_handle_hash(visible);
}

function _setup_more_toggle($w) {
	const $btn = $w.find("#ib-kb-more-toggle");
	const $panel = $w.find("#ib-kb-more-panel");
	$btn.on("click", function () {
		$(this).toggleClass("open");
		$panel.toggleClass("open");
	});
}

// ── Category pills ────────────────────────────────────────────────────────────

const CAT_LABELS = {
	all: "All", sales: "Sales", finance: "Finance", crm: "CRM",
	gst: "GST", reports: "Reports", stock: "Stock",
	hr: "HR", ai: "AI", production: "Production", comms: "Comms",
	dashboard: "Dashboards",
};

function _render_cats($w, visible) {
	const cats = ["all", ...new Set(visible.map(s => s.cat))];
	const $c = $w.find("#ib-kb-cats").empty();
	cats.forEach(cat => {
		$(`<button class="ib-kb-cat${cat === "all" ? " active" : ""}" data-cat="${cat}">${CAT_LABELS[cat] || cat}</button>`)
			.on("click", function () {
				$c.find(".ib-kb-cat").removeClass("active");
				$(this).addClass("active");
				const selected = $(this).data("cat");
				const $tabbar = $w.find("#ib-kb-tabbar");
				$tabbar.find(".ib-kb-tab").each(function () {
					const tab_cat = $(this).data("cat");
					$(this).toggle(selected === "all" || tab_cat === selected);
				});
				const $active = $tabbar.find(".ib-kb-tab.active");
				if (!$active.length || !$active.is(":visible")) {
					const $first = $tabbar.find(".ib-kb-tab:visible").first();
					if ($first.length) $first.trigger("click");
				}
			})
			.appendTo($c);
	});
}

// ── Sections ──────────────────────────────────────────────────────────────────

function _item_html(sec, item) {
	const _bdg = [];
	if (item.steps && item.steps.length > 1) _bdg.push(`<span class="ib-kb-badge ib-kb-badge-steps">${item.steps.length} steps</span>`);
	if (item.note) _bdg.push(`<span class="ib-kb-badge ib-kb-badge-note"><iconify-icon icon="lucide:pin" width="9" height="9"></iconify-icon> note</span>`);
	if (item.tip)  _bdg.push(`<span class="ib-kb-badge ib-kb-badge-tip"><iconify-icon icon="lucide:lightbulb" width="9" height="9"></iconify-icon> tip</span>`);
	return `
<div class="ib-kb-item" data-sec="${sec.id}" data-num="${item.num}"
     data-search="${[item.title,item.desc,item.note||"",(item.steps||[]).join(" "),item.tags||""].join(" ").replace(/<[^>]+>/g,"").replace(/"/g," ").toLowerCase()}">
  <div class="ib-kb-item-num">${item.num}</div>
  <div class="ib-kb-item-content">
    <div class="ib-kb-item-title-row">
      <span class="ib-kb-item-title">${item.title}</span>
      ${_bdg.length ? `<span class="ib-kb-item-badges">${_bdg.join("")}</span>` : ""}
    </div>
    <div class="ib-kb-item-desc">${item.desc}</div>
    ${item.link ? `<div class="ib-kb-item-footer">
      <a class="ib-kb-item-link" href="${item.link}" target="_blank"
         onclick="event.stopPropagation()">&#x2197; ${item.linkLabel || "Open"}</a>
    </div>` : ""}
  </div>
  <span class="ib-kb-item-arrow">&#x203A;</span>
</div>`;
}

function _wire_items($container, _index) {
	$container.find(".ib-kb-item").on("click", function () {
		const secId = $(this).data("sec");
		const num = $(this).data("num");
		const entry = _index.find(e => e.sec.id === secId && String(e.item.num) === String(num));
		if (entry) _open_drawer(entry.sec, entry.item, _index);
	});
}

function _render_sections($w, visible, _index) {
	const $tabbar = $w.find("#ib-kb-tabbar").empty();
	const $pane   = $w.find("#ib-kb-pane");

	let _activeId = visible.length ? visible[0].id : null;

	function _renderPane(sec) {
		if (!sec) { $pane.html(""); return; }
		$pane.html(sec.items.map(item => _item_html(sec, item)).join(""));
		_wire_items($pane, _index);
	}

	function _setActive(id) {
		_activeId = id;
		$tabbar.find(".ib-kb-tab").removeClass("active").filter(function () {
			return $(this).data("section") === id;
		}).addClass("active");
		_renderPane(visible.find(s => s.id === id));
	}

	visible.forEach((sec, si) => {
		$(`
<div class="ib-kb-tab" data-section="${sec.id}" data-cat="${sec.cat}" style="animation-delay:${si * 30}ms">
  <span class="ib-kb-tab-icon" style="background:${sec.color};color:${sec.iconColor}">${sec.icon}</span>
  <span class="ib-kb-tab-title">${sec.title}</span>
  <span class="ib-kb-tab-count" data-total="${sec.items.length}">${sec.items.length}</span>
</div>`)
			.on("click", function () { _setActive($(this).data("section")); })
			.appendTo($tabbar);
	});

	if (_activeId) _setActive(_activeId);

	$w.data("kb-set-active", _setActive);
	$w.data("kb-get-active", () => _activeId);
}

// ── Recently viewed ───────────────────────────────────────────────────────────

const RECENT_KEY = "ib_kb_recent_v2";

function _get_recent() {
	try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
	catch { return []; }
}

function _add_recent(sec, item) {
	const recent = _get_recent().filter(r => !(r.secId === sec.id && r.num === String(item.num)));
	recent.unshift({ secId: sec.id, num: String(item.num), title: item.title, icon: sec.icon });
	try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 6))); }
	catch {}
}

function _render_recent($w, _index) {
	const recent = _get_recent();
	const $div = $w.find("#ib-kb-recent");
	const $chips = $w.find("#ib-kb-recent-chips").empty();
	if (!recent.length) { $div.hide(); return; }
	$div.show();
	recent.forEach(r => {
		const entry = _index.find(e => e.sec.id === r.secId && String(e.item.num) === r.num);
		if (!entry) return;
		$(`<span class="ib-kb-recent-chip">
            <span class="rci">${r.icon || entry.sec.icon}</span>
            ${_esc(r.title)}
           </span>`)
			.on("click", () => _open_drawer(entry.sec, entry.item, _index))
			.appendTo($chips);
	});
}

// ── Drawer ────────────────────────────────────────────────────────────────────

const DOCTYPE_LINKS = {
	"Sales Invoice": "/app/sales-invoice",
	"Sales Order": "/app/sales-order",
	"Delivery Note": "/app/delivery-note",
	"Quotation": "/app/quotation",
	"Payment Entry": "/app/payment-entry",
	"Purchase Invoice": "/app/purchase-invoice",
	"Customer": "/app/customer",
	"Lead": "/app/lead",
	"Employee": "/app/employee",
	"Material Request": "/app/material-request",
	"Salary Slip": "/app/salary-slip",
	"Payment Reconciliation": "/app/payment-reconciliation",
};

function _linkify(html) {
	let out = html;
	Object.entries(DOCTYPE_LINKS).forEach(([term, url]) => {
		const re = new RegExp(`\\b(${term}s?)\\b(?![^<]*>)(?![^<]*</a>)`, "g");
		out = out.replace(re, `<a href="${url}" target="_blank" class="ib-kb-doclink">$1</a>`);
	});
	return out;
}

function _open_drawer(sec, item, _index) {
	_add_recent(sec, item);

	const $bc   = $("#ib-kb-drawer-bc");
	const $body = $("#ib-kb-drawer-body");
	const $foot = $("#ib-kb-drawer-footer");

	// Breadcrumb
	$bc.html(`
<span class="ib-kb-drawer-bc-icon">${sec.icon}</span>
<span class="bc-section" style="color:${sec.iconColor}">${sec.title}</span>
<span class="bc-arrow">&#x203A;</span>
<span>${_esc(item.title)}</span>`);

	// Build body HTML
	let html = `<h2>${_esc(item.title)}</h2>`;
	html += `<p class="desc">${_linkify(_esc(item.desc))}</p>`;

	if (item.steps && item.steps.length) {
		html += `<ol class="ib-kb-steps">`;
		item.steps.forEach(s => { html += `<li>${_linkify(s)}</li>`; });
		html += `</ol>`;
	}
	if (item.note) html += `<div class="ib-kb-note">&#128204; ${_linkify(item.note)}</div>`;
	if (item.tip)  html += `<div class="ib-kb-tip">&#128161; ${_linkify(item.tip)}</div>`;

	// Related items from same section (excluding current)
	const related = sec.items.filter(i => i.num !== item.num).slice(0, 3);
	if (related.length) {
		html += `<div class="ib-kb-related">
<div class="ib-kb-related-title">More in ${sec.title}</div>`;
		related.forEach(r => {
			html += `<div class="ib-kb-related-item" data-sec="${sec.id}" data-num="${r.num}">
<span class="ri-title">${_esc(r.title)}</span>
<span class="ri-arrow">&#x203A;</span>
</div>`;
		});
		html += `</div>`;
	}

	$body.html(html);

	// Wire related item clicks
	$body.find(".ib-kb-related-item").on("click", function () {
		const num = $(this).data("num");
		const ri = sec.items.find(i => String(i.num) === String(num));
		if (ri) _open_drawer(sec, ri, _index);
	});

	// Footer buttons
	$foot.empty();
	if (item.link) {
		$(`<a class="ib-kb-drawer-btn primary" href="${item.link}" target="_blank">
&#x2197; ${_esc(item.linkLabel || "Open in App")}
</a>`).appendTo($foot);
	}
	$(`<button class="ib-kb-drawer-btn secondary" id="ib-kb-copy-link">&#x1F517; Copy Link</button>`)
		.on("click", () => {
			const hash = `#${sec.id}/${item.num}`;
			const url = `${location.origin}${location.pathname}${hash}`;
			navigator.clipboard.writeText(url).then(() => {
				frappe.show_alert({ message: "Link copied", indicator: "green" });
			});
		})
		.appendTo($foot);

	// Prev / Next navigation
	const _itemIdx = sec.items.findIndex(i => String(i.num) === String(item.num));
	const _prevItem = _itemIdx > 0 ? sec.items[_itemIdx - 1] : null;
	const _nextItem = _itemIdx < sec.items.length - 1 ? sec.items[_itemIdx + 1] : null;
	if (_prevItem || _nextItem) {
		const $nav = $('<div class="ib-kb-drawer-nav">').appendTo($foot);
		const $prev = $(`<button class="ib-kb-nav-btn" ${!_prevItem ? "disabled" : ""}>&#x2039; ${_prevItem ? _esc(_prevItem.title.slice(0, 28)) + (_prevItem.title.length > 28 ? "…" : "") : "Previous"}</button>`)
			.on("click", () => { if (_prevItem) _open_drawer(sec, _prevItem, _index); })
			.appendTo($nav);
		const $next = $(`<button class="ib-kb-nav-btn" style="text-align:right" ${!_nextItem ? "disabled" : ""}>${_nextItem ? _esc(_nextItem.title.slice(0, 28)) + (_nextItem.title.length > 28 ? "…" : "") : "Next"} &#x203A;</button>`)
			.on("click", () => { if (_nextItem) _open_drawer(sec, _nextItem, _index); })
			.appendTo($nav);
	}

	// Update URL hash
	history.replaceState(null, "", `${location.pathname}#${sec.id}/${item.num}`);

	// Open
	$("#ib-kb-overlay").addClass("open");
	$("#ib-kb-drawer").addClass("open");

	// Trap focus
	$("#ib-kb-drawer")[0].focus();
}

function _close_drawer() {
	$("#ib-kb-overlay").removeClass("open");
	$("#ib-kb-drawer").removeClass("open");
	history.replaceState(null, "", location.pathname);
}

$(document).on("click", "#ib-kb-drawer-close, #ib-kb-overlay", _close_drawer);
$(document).on("keydown", e => {
	if (e.key === "Escape") _close_drawer();
});

// ── Search ────────────────────────────────────────────────────────────────────

function _expand_query(raw) {
	const corrected = [];
	let didCorrect = false;
	const correctionMap = {};

	raw.split(/\s+/).filter(Boolean).forEach(tok => {
		const low = tok.toLowerCase();
		if (TYPO_MAP[low]) {
			const fixed = TYPO_MAP[low];
			if (fixed !== low) { didCorrect = true; correctionMap[low] = fixed; }
			corrected.push(...fixed.split(/\s+/));
		} else {
			corrected.push(low);
		}
		// Synonym expansion
		Object.entries(SYNONYMS).forEach(([key, syns]) => {
			if (low === key || syns.includes(low)) {
				[key, ...syns].forEach(s => { if (!corrected.includes(s)) corrected.push(s); });
			}
		});
	});

	return { tokens: [...new Set(corrected)], didCorrect, correctionMap };
}

function _score(tokens, entry) {
	let score = 0;
	const titleLow = entry.item.title.toLowerCase();
	tokens.forEach(t => {
		if (!t) return;
		if (titleLow === t)            score += 12;
		else if (titleLow.startsWith(t)) score += 7;
		else if (titleLow.includes(t))   score += 5;
		else if (entry.blob.includes(t)) score += 2;
		else {
			// fuzzy prefix (min 3 chars)
			if (t.length >= 3) {
				const prefix = t.slice(0, Math.max(3, t.length - 1));
				if (entry.blob.includes(prefix)) score += 1;
			}
		}
	});
	return score;
}

function _setup_search($w, _index, visible) {
	const $input    = $w.find("#ib-kb-search");
	const $sugs     = $w.find("#ib-kb-suggestions");
	const $correct  = $w.find("#ib-kb-correction");
	const $noRes    = $w.find("#ib-kb-no-results");
	const $tabbar   = $w.find("#ib-kb-tabbar");
	const $pane     = $w.find("#ib-kb-pane");
	const $ql       = $w.find("#ib-kb-quick-links");
	const $recent   = $w.find("#ib-kb-recent");
	const $cats     = $w.find("#ib-kb-cats");
	const $wf       = $w.find(".ib-kb-workflow");

	let _timer;
	let _focused = -1;
	let _suggestions = [];

	function _reset() {
		$sugs.removeClass("open").empty();
		$correct.hide().empty();
		$noRes.hide();
		$ql.show();
		$recent.show();
		$cats.show();
		$wf.show();
		$tabbar.show();

		const setActive = $w.data("kb-set-active");
		const getActive = $w.data("kb-get-active");
		if (setActive && getActive) setActive(getActive());

		_focused = -1;
	}

	function _run_search(q) {
		q = (q || "").trim();
		if (!q) { _reset(); return; }

		const { tokens, didCorrect, correctionMap } = _expand_query(q);

		const scored = _index
			.map(e => ({ e, s: _score(tokens, e) }))
			.filter(x => x.s > 0)
			.sort((a, b) => b.s - a.s);

		_suggestions = scored.slice(0, 7);

		// Autocorrect hint
		if (didCorrect && _suggestions.length) {
			const fixed = Object.entries(correctionMap).map(([k, v]) => `<a>${v}</a>`).join(", ");
			$correct.html(`Showing results for ${fixed}`).show();
		} else {
			$correct.hide();
		}

		// Suggestions dropdown
		$sugs.empty();
		if (_suggestions.length === 0) {
			$sugs.html(`<div class="ib-kb-sug-empty">No results for "<b>${_esc(q)}</b>"</div>`);
		} else {
			_suggestions.forEach(({ e }, i) => {
				const { sec, item } = e;
				const titleHl = _highlight_text(item.title, tokens);
				const descSnip = (item.desc || "").slice(0, 80) + (item.desc.length > 80 ? "…" : "");
				$(`<div class="ib-kb-sug-item" data-idx="${i}">
<div class="ib-kb-sug-icon" style="background:${sec.color};color:${sec.iconColor}">${sec.icon}</div>
<div class="ib-kb-sug-text">
  <div class="ib-kb-sug-title">${titleHl}</div>
  <div class="ib-kb-sug-desc">${_esc(descSnip)}</div>
</div>
<div class="ib-kb-sug-section">${sec.title}</div>
</div>`).on("click", () => {
					$sugs.removeClass("open");
					$input.val("");
					_reset();
					_open_drawer(sec, item, _index);
				}).appendTo($sugs);
			});
			if (scored.length > 7) {
				$sugs.append(`<div class="ib-kb-sug-footer">${scored.length - 7} more results below</div>`);
			}
		}
		$sugs.addClass("open");
		_focused = -1;

		// Declutter while searching
		$ql.hide(); $recent.hide(); $wf.hide();
		$cats.find(".ib-kb-cat").removeClass("active");
		$cats.find(".ib-kb-cat[data-cat='all']").addClass("active");
		$tabbar.hide();

		// Flatten matches (across all sections) into the content pane
		if (scored.length === 0) {
			$pane.html("");
			$noRes.find("#ib-kb-no-q").text(`No results for "${q}"`).end().show();
			return;
		}
		$noRes.hide();

		let lastSecId = null;
		let html = "";
		scored.forEach(({ e }) => {
			if (e.sec.id !== lastSecId) {
				html += `<div class="ib-kb-pane-search-group">${_esc(e.sec.title)}</div>`;
				lastSecId = e.sec.id;
			}
			html += _item_html(e.sec, e.item);
		});
		$pane.html(html);
		_wire_items($pane, _index);
		$pane.find(".ib-kb-item").each(function () {
			_highlight($(".ib-kb-item-title", this), tokens);
			_highlight($(".ib-kb-item-desc", this), tokens);
		});
	}

	$input.on("input", function () {
		clearTimeout(_timer);
		const q = $(this).val();
		if (!q) { _reset(); return; }
		_timer = setTimeout(() => _run_search(q), 180);
	});

	// Keyboard nav in suggestions
	$input.on("keydown", function (e) {
		const items = $sugs.find(".ib-kb-sug-item");
		if (e.key === "ArrowDown") {
			e.preventDefault();
			_focused = Math.min(_focused + 1, items.length - 1);
			items.removeClass("kb-focused").eq(_focused).addClass("kb-focused");
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			_focused = Math.max(_focused - 1, -1);
			items.removeClass("kb-focused").eq(_focused).addClass("kb-focused");
		} else if (e.key === "Enter") {
			if (_focused >= 0 && _suggestions[_focused]) {
				const { sec, item } = _suggestions[_focused].e;
				$sugs.removeClass("open");
				$input.val("");
				_reset();
				_open_drawer(sec, item, _index);
			}
		} else if (e.key === "Escape") {
			$sugs.removeClass("open");
			$input.blur();
			_reset();
			$input.val("");
		}
	});

	// Close suggestions when clicking outside
	$(document).on("click.kbsearch", function (e) {
		if (!$(e.target).closest("#ib-kb-search-wrap").length) {
			$sugs.removeClass("open");
		}
	});

	// Clear search button
	$w.find("#ib-kb-clear-search").on("click", () => {
		$input.val("").trigger("input");
	});
}

// ── Workflow stepper ──────────────────────────────────────────────────────────

function _setup_workflow($w) {
	const $detail = $w.find("#ib-kb-wf-detail");
	const $title  = $w.find("#ib-kb-wf-title");
	const $body   = $w.find("#ib-kb-wf-body");

	$w.find(".ib-kb-flow-step").on("click", function () {
		const key = $(this).data("workflow");
		const wf = KB_WORKFLOWS[key];
		if (!wf) return;
		$w.find(".ib-kb-flow-step").removeClass("active");
		$(this).addClass("active");
		$title.text(wf.title);
		$body.html(wf.body);
		$detail.addClass("open");
		$detail[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
	});

	$w.find("#ib-kb-wf-close").on("click", () => {
		$detail.removeClass("open");
		$w.find(".ib-kb-flow-step").removeClass("active");
	});
}

// ── Keyboard shortcut (Ctrl+K) ────────────────────────────────────────────────

function _setup_keyboard($w) {
	$(document).on("keydown.kb", function (e) {
		if ((e.ctrlKey || e.metaKey) && e.key === "k") {
			e.preventDefault();
			const $s = $w.find("#ib-kb-search");
			if ($s.length) {
				$s[0].focus();
				$s[0].select();
			}
		}
	});
}

// ── Deep link (URL hash) ──────────────────────────────────────────────────────

function _handle_hash(visible) {
	const hash = (location.hash || "").slice(1);
	if (!hash) return;
	const [secId, num] = hash.split("/");
	const sec = visible.find(s => s.id === secId);
	if (!sec) return;
	const item = num ? sec.items.find(i => String(i.num) === num) : sec.items[0];
	if (!item) return;

	// Build minimal index for drawer
	const _index = [];
	visible.forEach(s => s.items.forEach(i => {
		_index.push({ sec: s, item: i, blob: [i.title, i.desc || "", (i.steps || []).join(" "), i.tags || ""].join(" ").toLowerCase() });
	}));

	setTimeout(() => _open_drawer(sec, item, _index), 300);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _esc(str) {
	return String(str || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function _highlight_text(text, tokens) {
	let out = _esc(text);
	tokens.forEach(t => {
		if (!t || t.length < 2) return;
		const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
		out = out.replace(re, "<mark class='ib-hl'>$1</mark>");
	});
	return out;
}

function _highlight($el, tokens) {
	$el.html(_highlight_text($el.text(), tokens));
}
