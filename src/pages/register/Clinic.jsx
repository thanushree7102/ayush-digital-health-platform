import RoleRegister from '../../components/RoleRegister';
import { FACILITY_TYPES, INFRASTRUCTURE, OWNERSHIP_TYPES, STATES, SYSTEMS } from '../../constants/options';

const fields = [
  { name: 'name', label: 'Registered / legal name', required: true },
  { name: 'displayName', label: 'Public display name (if different)' },
  { name: 'facilityType', label: 'Facility type', type: 'select', options: FACILITY_TYPES, required: true },
  { name: 'ownershipType', label: 'Ownership', type: 'select', options: OWNERSHIP_TYPES },
  { name: 'establishmentYear', label: 'Year established', digits: 4, pattern: /^\d{4}$/, patternMsg: 'Enter a 4-digit year' },
  { name: 'systems', label: 'Systems of medicine offered', type: 'multiselect', options: SYSTEMS, required: true },
  { name: 'infrastructure', label: 'Available facilities', type: 'multiselect', options: INFRASTRUCTURE },
  { name: 'licenceNo', label: 'Licence / registration number', required: true },
  { name: 'authority', label: 'Issuing authority' },
  { name: 'registrationType', label: 'Type of registration / licence' },
  { name: 'issueDate', label: 'Licence issue date', type: 'date' },
  { name: 'expiryDate', label: 'Licence expiry / renewal date', type: 'date' },
  { name: 'address', label: 'Address', type: 'textarea', required: true },
  { name: 'city', label: 'City / town' },
  { name: 'district', label: 'District' },
  { name: 'state', label: 'State', type: 'select', options: STATES, required: true },
  { name: 'pincode', label: 'Pincode', digits: 6, required: true, pattern: /^\d{6}$/, patternMsg: 'Pincode must be 6 digits' },
  { name: 'mobile', label: 'Official phone / mobile number', digits: 10, required: true, pattern: /^[6-9]\d{9}$/, patternMsg: 'Enter a valid 10-digit mobile number' },
  { name: 'email', label: 'Official email', type: 'email', pattern: /^\S+@\S+\.\S+$/, patternMsg: 'Enter a valid email' },
  { name: 'website', label: 'Website (optional)' },
];

export default function Clinic() {
  return (
    <RoleRegister
      role="facility"
      aadhaarFill={['addressLine', 'address', 'city', 'state', 'pincode']}
      title="Clinic / hospital registration"
      intro="Register your facility. You get a Facility ID to share with your doctors."
      endpoint="/auth/register/facility"
      fields={fields}
      steps={{ certificate: { label: 'Licence document (PDF/JPG/PNG)', error: 'Upload the licence document' }, declaration: 'I am authorised to register this facility and the details are true.', submit: 'Submit for verification' }}
    />
  );
}
