// Land on the API Overview without a flash of the Explorer; share links open the Explorer directly
if (location.search.indexOf('eurex-api-state=') < 0) document.documentElement.classList.add('boot-overview');
