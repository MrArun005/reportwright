import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportWrightViewer, ReportWrightDesigner } from '@reportwright/react';
import definition from '../../report.pw.json';
import orders from '../../data.json';

function App() {
  const [design, setDesign] = useState(false);
  return (
    <>
      <button onClick={() => setDesign(!design)}>{design ? 'View' : 'Design'}</button>
      {design
        ? <ReportWrightDesigner definition={definition} fontsUrl="/pw/fonts/" onSave={(d) => console.log('saved', d)} style={{ height: 760 }} />
        : <ReportWrightViewer definition={definition} data={{ orders }} fontsUrl="/pw/fonts/" onError={(e) => console.error(e)} style={{ height: 760 }} />}
    </>
  );
}
createRoot(document.getElementById('app')).render(<App />);
