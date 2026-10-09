const R = 6371000;
const p1 = {lat: 13.126597, lng: 80.100229};
const p2 = {lat: 13.126550, lng: 80.100217};
const dLat = (p2.lat - p1.lat) * Math.PI / 180;
const dLng = (p2.lng - p1.lng) * Math.PI / 180;
const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
console.log("Distance: ", R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
