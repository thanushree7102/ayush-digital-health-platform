import FormPage from '../components/FormPage';
import usePrefill from '../hooks/usePrefill';
import { PRAKRITI_OPTIONS, VIKRITI_OPTIONS } from '../constants/options';

const prakritiFields = [
  { name: 'prakriti', label: 'Prakriti (constitution)', type: 'select', options: PRAKRITI_OPTIONS, required: true },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
const vikritiFields = [
  { name: 'vikriti', label: 'Current Vikriti (imbalance)', type: 'select', options: VIKRITI_OPTIONS, required: true },
  { name: 'symptoms', label: 'Related symptoms', type: 'textarea' },
];

export default function PrakritiVikriti() {
  const prefill = usePrefill('prakriti');
  return (
    <>
      <FormPage title="Prakriti" endpoint="prakriti" fields={prakritiFields} prefill={prefill} />
      <FormPage title="Vikriti" endpoint="vikriti" fields={vikritiFields} />
    </>
  );
}
