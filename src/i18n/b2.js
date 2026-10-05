// UI strings for batch 2 (Designer and viewer upgrade, accessibility, phone). Merged into each language by index.js.
// One row per key, in the order of LANGS; the same placeholders in every language.
const LANGS = ['en', 'hi', 'es', 'fr', 'de', 'ja', 'zh', 'pt-BR', 'ar'];
const ROWS = {
  b2_skipBlank: ['Skip when the parameter is blank', 'पैरामीटर खाली हो तो छोड़ें', 'Omitir si el parámetro está vacío', 'Ignorer si le paramètre est vide', 'Überspringen, wenn der Parameter leer ist', 'パラメーターが空のときはスキップ', '参数为空时跳过', 'Ignorar quando o parâmetro estiver vazio', 'تخطَّ عندما تكون المعلمة فارغة'],
  // viewer
  b2_pageOf: ['Page {n} of {total}', 'पृष्ठ {n} / {total}', 'Página {n} de {total}', 'Page {n} sur {total}', 'Seite {n} von {total}', '{total} ページ中 {n} ページ', '第 {n} 页，共 {total} 页', 'Página {n} de {total}', 'الصفحة {n} من {total}'],
  b2_pageN: ['Page {n}', 'पृष्ठ {n}', 'Página {n}', 'Page {n}', 'Seite {n}', '{n} ページ', '第 {n} 页', 'Página {n}', 'الصفحة {n}'],
  b2_pages: ['Pages', 'पृष्ठ', 'Páginas', 'Pages', 'Seiten', 'ページ', '页面', 'Páginas', 'الصفحات'],
  b2_contents: ['Contents', 'विषय-सूची', 'Contenido', 'Sommaire', 'Inhalt', '目次', '目录', 'Sumário', 'المحتويات'],
  b2_sidebar: ['Pages and contents', 'पृष्ठ और विषय-सूची', 'Páginas y contenido', 'Pages et sommaire', 'Seiten und Inhalt', 'ページと目次', '页面和目录', 'Páginas e sumário', 'الصفحات والمحتويات'],
  b2_export: ['Export', 'निर्यात', 'Exportar', 'Exporter', 'Exportieren', 'エクスポート', '导出', 'Exportar', 'تصدير'],
  b2_fmt_pdf: ['PDF document', 'PDF दस्तावेज़', 'Documento PDF', 'Document PDF', 'PDF-Dokument', 'PDF ドキュメント', 'PDF 文档', 'Documento PDF', 'مستند PDF'],
  b2_fmt_xlsx: ['Excel workbook', 'Excel वर्कबुक', 'Libro de Excel', 'Classeur Excel', 'Excel-Arbeitsmappe', 'Excel ブック', 'Excel 工作簿', 'Pasta de trabalho do Excel', 'مصنف Excel'],
  b2_fmt_docx: ['Word document', 'Word दस्तावेज़', 'Documento de Word', 'Document Word', 'Word-Dokument', 'Word 文書', 'Word 文档', 'Documento do Word', 'مستند Word'],
  b2_fmt_pptx: ['PowerPoint slides', 'PowerPoint स्लाइड', 'Diapositivas de PowerPoint', 'Diapositives PowerPoint', 'PowerPoint-Folien', 'PowerPoint スライド', 'PowerPoint 幻灯片', 'Slides do PowerPoint', 'شرائح PowerPoint'],
  b2_fmt_html: ['Web page', 'वेब पेज', 'Página web', 'Page web', 'Webseite', 'Web ページ', '网页', 'Página da web', 'صفحة ويب'],
  b2_fmt_csv: ['Table data (CSV)', 'तालिका डेटा (CSV)', 'Datos de tabla (CSV)', 'Données du tableau (CSV)', 'Tabellendaten (CSV)', '表データ (CSV)', '表格数据 (CSV)', 'Dados da tabela (CSV)', 'بيانات الجدول (CSV)'],
  b2_fmt_json: ['Rendered report (JSON)', 'रेंडर की गई रिपोर्ट (JSON)', 'Informe generado (JSON)', 'Rapport rendu (JSON)', 'Gerenderter Bericht (JSON)', 'レンダリング済みレポート (JSON)', '渲染后的报表 (JSON)', 'Relatório gerado (JSON)', 'التقرير المعروض (JSON)'],
  // designer
  b2_file: ['File', 'फ़ाइल', 'Archivo', 'Fichier', 'Datei', 'ファイル', '文件', 'Arquivo', 'ملف'],
  b2_insert: ['Insert', 'डालें', 'Insertar', 'Insérer', 'Einfügen', '挿入', '插入', 'Inserir', 'إدراج'],
  b2_arrange: ['Arrange', 'व्यवस्थित करें', 'Organizar', 'Organiser', 'Anordnen', '配置', '排列', 'Organizar', 'ترتيب'],
  b2_view: ['View', 'दृश्य', 'Vista', 'Affichage', 'Ansicht', '表示', '视图', 'Exibir', 'عرض'],
  b2_previewGroup: ['Preview', 'पूर्वावलोकन', 'Vista previa', 'Aperçu', 'Vorschau', 'プレビュー', '预览', 'Visualização', 'معاينة'],
  b2_insertItem: ['Insert: {item}', 'डालें: {item}', 'Insertar: {item}', 'Insérer : {item}', 'Einfügen: {item}', '挿入: {item}', '插入：{item}', 'Inserir: {item}', 'إدراج: {item}'],
  b2_insertHint: ['Goes inside the selected list or container, else below the body', 'चुनी गई सूची या कंटेनर के अंदर, वरना बॉडी के नीचे जाता है', 'Va dentro de la lista o el contenedor seleccionado; si no, debajo del cuerpo', 'Va dans la liste ou le conteneur sélectionné, sinon sous le corps', 'Kommt in die ausgewählte Liste oder den Container, sonst unter den Hauptteil', '選択したリストやコンテナーの中に、なければ本文の下に入ります', '放入所选列表或容器中，否则放在正文下方', 'Vai dentro da lista ou do contêiner selecionado; senão, abaixo do corpo', 'يُدرج داخل القائمة أو الحاوية المحددة، وإلا أسفل المتن'],
  b2_toolbox: ['Toolbox', 'टूलबॉक्स', 'Herramientas', 'Boîte à outils', 'Werkzeuge', 'ツールボックス', '工具箱', 'Ferramentas', 'الأدوات'],
  b2_data: ['Data', 'डेटा', 'Datos', 'Données', 'Daten', 'データ', '数据', 'Dados', 'البيانات'],
  b2_outline: ['Outline', 'रूपरेखा', 'Esquema', 'Structure', 'Gliederung', 'アウトライン', '大纲', 'Estrutura', 'المخطط'],
  b2_panels: ['Designer panels', 'डिज़ाइनर पैनल', 'Paneles del diseñador', 'Panneaux du concepteur', 'Designer-Bereiche', 'デザイナーのパネル', '设计器面板', 'Painéis do designer', 'لوحات المصمم'],
  b2_leftPanel: ['Show or hide the side panel', 'साइड पैनल दिखाएँ या छिपाएँ', 'Mostrar u ocultar el panel lateral', 'Afficher ou masquer le panneau latéral', 'Seitenbereich ein- oder ausblenden', 'サイドパネルの表示/非表示', '显示或隐藏侧面板', 'Mostrar ou ocultar o painel lateral', 'إظهار اللوحة الجانبية أو إخفاؤها'],
  b2_rightPanel: ['Show or hide the Inspector', 'इंस्पेक्टर दिखाएँ या छिपाएँ', 'Mostrar u ocultar el Inspector', "Afficher ou masquer l'inspecteur", 'Inspektor ein- oder ausblenden', 'インスペクターの表示/非表示', '显示或隐藏检查器', 'Mostrar ou ocultar o Inspetor', 'إظهار المراقب أو إخفاؤه'],
  b2_inspector: ['Inspector', 'इंस्पेक्टर', 'Inspector', 'Inspecteur', 'Inspektor', 'インスペクター', '检查器', 'Inspetor', 'المراقب'],
  b2_status: ['Status', 'स्थिति', 'Estado', 'État', 'Zustand', 'ステータス', '状态', 'Situação', 'الحالة'],
  b2_selReport: ['Report', 'रिपोर्ट', 'Informe', 'Rapport', 'Bericht', 'レポート', '报表', 'Relatório', 'التقرير'],
  b2_selItems: ['{n} items selected', '{n} आइटम चुने गए', '{n} elementos seleccionados', '{n} éléments sélectionnés', '{n} Elemente ausgewählt', '{n} 個の項目を選択', '已选择 {n} 个项目', '{n} itens selecionados', 'تم تحديد {n} عناصر'],
  b2_selBand: ['Band: {band}', 'बैंड: {band}', 'Banda: {band}', 'Bande : {band}', 'Bereich: {band}', 'バンド: {band}', '区域：{band}', 'Faixa: {band}', 'النطاق: {band}'],
  b2_selCell: ['Cell in {name}', '{name} में सेल', 'Celda de {name}', 'Cellule de {name}', 'Zelle in {name}', '{name} のセル', '{name} 中的单元格', 'Célula em {name}', 'خلية في {name}'],
  b2_pageInfo: ['Page {size} · {w} × {h} {unit}', 'पृष्ठ {size} · {w} × {h} {unit}', 'Página {size} · {w} × {h} {unit}', 'Page {size} · {w} × {h} {unit}', 'Seite {size} · {w} × {h} {unit}', 'ページ {size} · {w} × {h} {unit}', '页面 {size} · {w} × {h} {unit}', 'Página {size} · {w} × {h} {unit}', 'الصفحة {size} · {w} × {h} {unit}'],
};
export default Object.fromEntries(LANGS.map((l, i) => [l, Object.fromEntries(Object.entries(ROWS).map(([k, v]) => [k, v[i]]))]));
