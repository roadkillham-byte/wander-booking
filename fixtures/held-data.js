// Sample client for the Held screen. Stands in for the sync from Coffee Van until it is built (see the build plan).
// Not a real client: the name, address and date are invented. The price is what Coffee Van's quote gives for 20 people, 3 hours.
window.WANDER_HELD = {
  name: "Alex",
  status: "held",
  replyWithinHours: 24,
  ticket: {
    date: "Saturday 5 December 2026",
    people: 20,
    hours: 3,
    startTime: "9:00 am",
    address: "1 Main Street, Forster",
  },
  total: 619,
  perHead: 31,
  footprints: ["asked", "held"],
};
