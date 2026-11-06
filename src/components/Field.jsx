import { useLang } from '../i18n';
import VoiceMic from './VoiceMic';

export default function Field({ field, value, error, onChange, disabled }) {
  const { t } = useLang();
  const { name, label, type = 'text', options = [], required, digits } = field;
  const id = `f-${name}`;
  let input;
  const voice = !disabled && !['date', 'password', 'multiselect'].includes(type);
  const mode = type === 'select' ? 'select' : type === 'email' ? 'email' : digits ? 'digits' : type === 'textarea' ? 'area' : 'text';

  if (type === 'select') {
    input = (
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(name, e.target.value)}>
        <option value="">{t('-- Select --')}</option>
        {options.map((o) => <option key={o} value={o}>{t(o)}</option>)}
      </select>
    );
  } else if (type === 'multiselect') {
    input = (
      <div className="checks">
        {options.map((o) => (
          <label key={o}>
            <input type="checkbox" disabled={disabled} checked={value.includes(o)}
              onChange={(e) => onChange(name, e.target.checked ? [...value, o] : value.filter((v) => v !== o))} />{' '}{t(o)}
          </label>
        ))}
      </div>
    );
  } else if (type === 'textarea') {
    input = <textarea id={id} rows={3} value={value} disabled={disabled} onChange={(e) => onChange(name, e.target.value)} />;
  } else {
    input = <input id={id} type={type} inputMode={digits ? 'numeric' : undefined} value={value} disabled={disabled} onChange={(e) => onChange(name, e.target.value)} />;
  }

  return (
    <div className={`field ${error ? 'invalid' : ''}`}>
      <label htmlFor={id}>{t(label)}{required && ' *'}</label>
      <div className="vwrap">
        {input}
        {voice && <VoiceMic onValue={(v) => onChange(name, v)} spec={{ mode, options, digits, current: value }} />}
      </div>
      {error && <span className="error-text">{t(error)}</span>}
    </div>
  );
}
