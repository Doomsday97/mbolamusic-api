// Utilidades de fecha

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isExpired(endDate) {
  return new Date(endDate).getTime() < Date.now();
}

module.exports = { addDays, isExpired };
