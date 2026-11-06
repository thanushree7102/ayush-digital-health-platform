export default function Steps({ current }) {
  const items = ['Registration', 'Prescription upload'];
  return (
    <div className="steps">
      {items.map((label, i) => (
        <div key={label} className={`step ${i + 1 === current ? 'on' : ''} ${i + 1 < current ? 'done' : ''}`}>
          <span className="dot">{i + 1 < current ? '✓' : i + 1}</span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
