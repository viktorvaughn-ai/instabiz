frappe.router.on('change', () => {
    // If the user lands exactly on /app or #modules
    if (window.location.pathname === '/app/home' && !frappe.get_route_str()) {
        window.location.href = '/app/instabiz';
    }
});

// Also fallback to a standard click event listener once the DOM is ready
$(document).ready(() => {
    $('body').on('click', '.app-logo', function(e) {
        e.preventDefault();
        window.location.href = '/app/instabiz';
    });
});