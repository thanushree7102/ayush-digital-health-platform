import FormPage from '../components/FormPage';
import { AGNI_OPTIONS, KOSHTHA_OPTIONS } from '../constants/options';

const fields = [
  { name: 'agni', label: 'Agni', type: 'select', options: AGNI_OPTIONS, required: true },
  { name: 'koshtha', label: 'Koshtha', type: 'select', options: KOSHTHA_OPTIONS, required: true },
  { name: 'relatedFindings', label: 'Related examination findings', type: 'textarea' },
];

export default function Examination() {
  return <FormPage title="Agni / Koshtha Examination" endpoint="examination" fields={fields} />;
}
