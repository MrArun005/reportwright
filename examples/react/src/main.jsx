import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PagewrightViewer, PagewrightDesigner } from '@pagewrightjs/react';
import definition from '../../report.pw.json';
import orders from '../../data.json';

function App() {
  const [design, setDesign] = useState(false);
  return (
    <>
      <button onClick={() => setDesign(!design)}>{design ? 'View' : 'Design'}</button>
      {design
        ? <PagewrightDesigner definition={definition} fontsUrl="/pw/fonts/" onSave={(d) => console.log('saved', d)} style={{ height: 760 }} />
        : <PagewrightViewer definition={definition} data={{ orders }} fontsUrl="/pw/fonts/" onError={(e) => console.error(e)} style={{ height: 760 }} />}
    </>
  );
}
createRoot(document.getElementById('app')).render(<App />);
