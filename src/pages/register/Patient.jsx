import RoleRegister from '../../components/RoleRegister';
import { GENDERS, RELATIONSHIPS, STATES } from '../../constants/options';

const fields = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'mobile', label: 'Mobile number', digits: 10, required: true },
  { name: 'dob', label: 'Date of birth', type: 'date' },
  { name: 'gender', label: 'Gender', type: 'select', options: GENDERS },
  { name: 'email', label: 'Email (optional)', type: 'email', pattern: /^\S+@\S+\.\S+$/, patternMsg: 'Enter a valid email' },
  { name: 'addressLine', label: 'Address' },
  { name: 'city', label: 'City / town' },
  { name: 'state', label: 'State', type: 'select', options: STATES },
  { name: 'pincode', label: 'Pincode', digits: 6, pattern: /^(\d{6})?$/, patternMsg: 'Pincode must be 6 digits' },
  { name: 'emergencyName', label: 'Emergency contact name' },
  { name: 'emergencyRelationship', label: 'Relationship', type: 'select', options: RELATIONSHIPS },
  { name: 'emergencyPhone', label: 'Emergency contact number', digits: 10, pattern: /^([6-9]\d{9})?$/, patternMsg: 'Enter a valid 10-digit mobile number' },
];

export default function Patient() {
  return (
    <RoleRegister
      role="patient"
      json
      aadhaarLink
      aadhaarFill={['name', 'dob', 'gender', 'addressLine', 'city', 'state', 'pincode', 'email']}
      title="Patient registration"
      intro="Only your name is needed after the face step. Everything else is optional, and you can add medical history later from your profile."
      endpoint="/auth/register"
      fields={fields}
      steps={{ declaration: 'I accept the privacy notice and agree to create my health record.', submit: 'Create my record' }}
    />
  );
}
