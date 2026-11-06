import RoleRegister from '../../components/RoleRegister';
import { COUNCILS, STATES, SYSTEMS } from '../../constants/options';

const fields = [
  { name: 'name', label: 'Full name (as on certificate)', required: true },
  { name: 'system', label: 'System of medicine', type: 'select', options: SYSTEMS, required: true },
  { name: 'qualification', label: 'Degree (e.g. BAMS, MD Ayurveda)', required: true },
  { name: 'institution', label: 'College / institution' },
  { name: 'university', label: 'Awarding university' },
  { name: 'graduationYear', label: 'Graduation year', digits: 4, pattern: /^\d{4}$/, patternMsg: 'Enter a 4-digit year' },
  { name: 'council', label: 'Registering council', type: 'select', options: COUNCILS, required: true },
  { name: 'registrationNo', label: 'Council registration number', required: true },
  { name: 'issueDate', label: 'Registration issue date', type: 'date' },
  { name: 'expiryDate', label: 'Registration expiry / renewal date', type: 'date' },
  { name: 'specializations', label: 'Specializations (comma separated, optional)' },
  { name: 'experience', label: 'Years of experience', digits: 2, pattern: /^\d{0,2}$/, patternMsg: 'Numbers only' },
  { name: 'languages', label: 'Languages for consultation (e.g. English, Kannada)' },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State', type: 'select', options: STATES },
  { name: 'mobile', label: 'Mobile number', digits: 10, required: true, pattern: /^[6-9]\d{9}$/, patternMsg: 'Enter a valid 10-digit mobile number' },
  { name: 'email', label: 'Professional email', type: 'email', pattern: /^\S+@\S+\.\S+$/, patternMsg: 'Enter a valid email' },
  { name: 'facilityId', label: 'Clinic / Hospital ID (optional, e.g. F-1234)' },
];

export default function Doctor() {
  return (
    <RoleRegister
      role="practitioner"
      aadhaarFill={['name', 'city', 'state', 'email']}
      title="Doctor / practitioner registration"
      intro="We verify your council registration before you can open any patient record."
      endpoint="/auth/register/practitioner"
      fields={fields}
      steps={{ certificate: { label: 'Registration certificate (PDF/JPG/PNG)', error: 'Upload your registration certificate' }, declaration: 'I confirm my details are true and I will access records only with patient consent.', submit: 'Submit for verification' }}
    />
  );
}
