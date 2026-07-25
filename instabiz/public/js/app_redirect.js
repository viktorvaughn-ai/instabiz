// Per-user override (User default "custom_home_route", set via
// frappe.defaults.set_user_default) — blank for everyone except whoever
// explicitly needs a different landing page than /app/instabiz.
function _ib_home_route() {
    const defaults = frappe.boot && frappe.boot.user && frappe.boot.user.defaults;
    const override = defaults && defaults.custom_home_route;
    return override || '/app/instabiz';
}

frappe.router.on('change', () => {
    // If the user lands exactly on /app or #modules
    if (window.location.pathname === '/app/home' && !frappe.get_route_str()) {
        window.location.href = _ib_home_route();
    }
});

// Also fallback to a standard click event listener once the DOM is ready
$(document).ready(() => {
    $('body').on('click', '.app-logo', function(e) {
        e.preventDefault();
        window.location.href = _ib_home_route();
    });
});