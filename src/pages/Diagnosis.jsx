import FormPage from '../components/FormPage';
import usePrefill from '../hooks/usePrefill';

const fields = [
  { name: 'diagnosis', label: 'Ayurveda diagnosis', required: true },
  { name: 'terminologyCode', label: 'Terminology code (NAMASTE / ICD-11 TM, optional)' },
  { name: 'notes', label: 'Clinical notes', type: 'textarea' },
];

export default function Diagnosis() {
  return <FormPage title="Ayurveda Diagnosis" endpoint="diagnosis" fields={fields} requiredRole="practitioner" prefill={usePrefill('diagnosis')} />;
}
