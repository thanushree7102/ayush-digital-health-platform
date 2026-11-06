// DEMO Aadhaar lookup. There is no connection to UIDAI here: these are made-up people stored in `demo_aadhaar`.
// Entering one of these numbers fills the registration form (name, date of birth, gender, address ...), the way
// a real Aadhaar e-KYC would, so the screens can be shown end to end. The full number is never saved by the
// platform: only the masked form (XXXX XXXX 1234) goes into the patient record, same as before.
//
// To go live: replace `lookup()` with a licensed UIDAI / ABDM e-KYC call and keep the consent + audit steps.
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS demo_aadhaar (
  aadhaar TEXT PRIMARY KEY CHECK (length(aadhaar) = 12),
  full_name TEXT NOT NULL, date_of_birth TEXT NOT NULL, gender TEXT NOT NULL,
  address_line TEXT, city TEXT, state TEXT, pincode TEXT, email TEXT, abha TEXT
);`);

// Verhoeff checksum, the one real Aadhaar numbers use, so the demo numbers also pass a real validity check.
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
const verhoeffValid = (num) => { let c = 0; [...String(num)].reverse().forEach((d, i) => { c = D[c][P[i % 8][+d]]; }); return c === 0; };
const withCheckDigit = (base11) => { for (let k = 0; k < 10; k++) if (verhoeffValid(base11 + k)) return base11 + k; return null; };

const PEOPLE = [
  ['23456789012', 'Ananya Rao', '1996-03-14', 'Female', '12, 4th Cross, Indiranagar', 'Bengaluru', 'Karnataka', '560038', 'ananya.rao@example.in'],
  ['34567890123', 'Ravi Kumar', '1985-07-22', 'Male', '45, Kuvempunagar', 'Mysuru', 'Karnataka', '570023', 'ravi.kumar@example.in'],
  ['45678901234', 'Lakshmi Devi', '1962-11-05', 'Female', '7, Kadri Road', 'Mangaluru', 'Karnataka', '575002', null],
  ['56789012345', 'Dr. Suresh Hegde', '1978-01-30', 'Male', '88, Vidyagiri', 'Dharwad', 'Karnataka', '580001', 'suresh.hegde@example.in'],
  ['67890123456', 'Priya Sharma', '1990-09-09', 'Female', 'B-14, Lajpat Nagar', 'New Delhi', 'Delhi', '110024', 'priya.sharma@example.in'],
  ['78901234567', 'Mohammed Irfan', '1988-12-02', 'Male', '23, Gokul Road', 'Hubballi', 'Karnataka', '580030', null],
];
const seedAll = db.transaction(() => PEOPLE.forEach(([base, ...rest]) => {
  const a = withCheckDigit(base);
  db.prepare('INSERT OR IGNORE INTO demo_aadhaar (aadhaar,full_name,date_of_birth,gender,address_line,city,state,pincode,email) VALUES (?,?,?,?,?,?,?,?,?)').run(a, ...rest);
}));
seedAll();

const DEMO_NUMBERS = db.prepare('SELECT aadhaar, full_name FROM demo_aadhaar ORDER BY aadhaar').all();

module.exports = function install(v1, { audit }) {
  // A short list of demo numbers for the "try one" chips (turn off with DEMO_AADHAAR_HINT=0).
  v1.get('/aadhaar/demo', (req, res) => {
    if (process.env.DEMO_AADHAAR_HINT === '0') return res.json([]);
    res.json(DEMO_NUMBERS.map((d) => ({ aadhaar: d.aadhaar, name: d.full_name })));
  });

  v1.post('/aadhaar/fetch', (req, res) => {
    const b = req.body || {};
    const a = String(b.aadhaar || '').replace(/\s/g, '');
    if (!/^[2-9]\d{11}$/.test(a)) return res.status(400).json({ message: 'Aadhaar number must be 12 digits and cannot start with 0 or 1.' });
    if (!verhoeffValid(a)) return res.status(400).json({ message: 'This Aadhaar number is not valid (check the digits).' });
    if (!(b.consent === true || b.consent === 'true')) return res.status(400).json({ message: 'Please agree to fetch your details from Aadhaar.' });
    const r = db.prepare('SELECT * FROM demo_aadhaar WHERE aadhaar = ?').get(a);
    const masked = `XXXX XXXX ${a.slice(-4)}`;
    if (!r) {
      audit(req, { action: 'AADHAAR_FETCH', type: 'identity', result: 'Failure', reason: `not found ${masked}` });
      return res.status(404).json({ message: 'No details found for this number in the demo directory. Try one of the demo numbers.' });
    }
    audit(req, { action: 'AADHAAR_FETCH', type: 'identity', ref: masked });
    res.json({ demo: true, maskedAadhaar: masked, name: r.full_name, dob: r.date_of_birth, gender: r.gender, addressLine: r.address_line, city: r.city, state: r.state, pincode: r.pincode, email: r.email || '' });
  });
};
module.exports.verhoeffValid = verhoeffValid;
