package bench;

import java.awt.Color;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.*;

import static bench.Frame.*;

/** Java contestants: Apache PDFBox 3, OpenPDF and iText 9 core. java -cp ... bench.Libs <lib> <job> <size> <outdir> */
public final class Libs {
  public static void main(String[] args) {
    Frame.main(args, Map.of("pdfbox", PdfBox::new, "openpdf", OpenPdf::new, "itext", IText::new));
  }

  static Color color(String hex) { return Color.decode(hex); }
  static KeyStore.PrivateKeyEntry p12(Cert c) throws Exception {
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (InputStream in = new FileInputStream(c.p12())) { ks.load(in, c.pass().toCharArray()); }
    String alias = ks.aliases().nextElement();
    return (KeyStore.PrivateKeyEntry) ks.getEntry(alias, new KeyStore.PasswordProtection(c.pass().toCharArray()));
  }
  static String pageFile(String dir, int i) { return Paths.get(dir, String.format("p-%04d.pdf", i)).toString(); }

  // ---------------------------------------------------------------- Apache PDFBox 3
  static final class PdfBox extends Lib {
    public String version() { return mavenVersion("org.apache.pdfbox", "pdfbox"); }
    public CanvasFactory canvas() {
      return (out, keys, title, pdfa) -> new Canvas() {
        final org.apache.pdfbox.pdmodel.PDDocument doc = new org.apache.pdfbox.pdmodel.PDDocument();
        final Map<String, org.apache.pdfbox.pdmodel.font.PDType0Font> f = new HashMap<>();
        org.apache.pdfbox.pdmodel.PDPageContentStream cs;
        {
          doc.getDocumentInformation().setTitle(title);
          for (String k : keys) f.put(k, org.apache.pdfbox.pdmodel.font.PDType0Font.load(doc, new File(font(k))));
        }
        public void page() throws Exception {
          if (cs != null) cs.close();
          var p = new org.apache.pdfbox.pdmodel.PDPage(new org.apache.pdfbox.pdmodel.common.PDRectangle((float) W, (float) H));
          doc.addPage(p);
          cs = new org.apache.pdfbox.pdmodel.PDPageContentStream(doc, p);
        }
        public void text(String s, double x, double y, double size, String k, boolean rtl) throws Exception {
          cs.beginText(); cs.setFont(f.get(k), (float) size); cs.newLineAtOffset((float) x, (float) (H - y - 0.8 * size)); cs.showText(s); cs.endText();
        }
        public double width(String s, double size, String k) throws Exception { return f.get(k).getStringWidth(s) / 1000 * size; }
        public void rect(double x, double y, double w, double h, String hex) throws Exception {
          cs.setNonStrokingColor(color(hex)); cs.addRect((float) x, (float) (H - y - h), (float) w, (float) h); cs.fill(); cs.setNonStrokingColor(Color.BLACK);
        }
        public void hline(double x1, double x2, double y, double w, String hex) throws Exception {
          cs.setStrokingColor(color(hex)); cs.setLineWidth((float) w); cs.moveTo((float) x1, (float) (H - y)); cs.lineTo((float) x2, (float) (H - y)); cs.stroke();
        }
        public Object image(String path) throws Exception { return org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject.createFromFile(path, doc); }
        public void draw(Object img, double x, double y, double w, double h) throws Exception {
          cs.drawImage((org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject) img, (float) x, (float) (H - y - h), (float) w, (float) h);
        }
        public void end() throws Exception { if (cs != null) cs.close(); doc.save(out); doc.close(); }
      };
    }
    static org.apache.pdfbox.pdmodel.PDDocument load(String f) throws IOException { return org.apache.pdfbox.Loader.loadPDF(new File(f)); }
    public String extract(String file) throws Exception {
      try (var d = load(file)) { return new org.apache.pdfbox.text.PDFTextStripper().getText(d); }
    }
    public void merge(List<String> files, String out) throws Exception {
      var m = new org.apache.pdfbox.multipdf.PDFMergerUtility();
      for (String f : files) m.addSource(new File(f));
      m.setDestinationFileName(out);
      m.mergeDocuments(org.apache.pdfbox.io.IOUtils.createMemoryOnlyStreamCache());
    }
    public void split(String file, String dir) throws Exception {
      try (var d = load(file)) {
        int i = 0;
        for (var part : new org.apache.pdfbox.multipdf.Splitter().split(d)) { part.save(pageFile(dir, ++i)); part.close(); }
      }
    }
    public void encrypt(String file, String out, String user, String owner) throws Exception {
      try (var d = load(file)) {
        var spp = new org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy(owner, user, new org.apache.pdfbox.pdmodel.encryption.AccessPermission());
        spp.setEncryptionKeyLength(256);
        d.protect(spp);
        d.save(out);
      }
    }
    public void metadata(String file, String out, String title) throws Exception {
      try (var d = load(file); var os = new FileOutputStream(out)) {
        var info = d.getDocumentInformation();
        info.setTitle(title);
        info.getCOSObject().setNeedToBeUpdated(true);
        d.saveIncremental(os);
      }
    }
    public void form(String file, String out, Map<String, Object> v) throws Exception {
      try (var d = load(file)) {
        var af = d.getDocumentCatalog().getAcroForm();
        af.getField("name").setValue(str(v.get("name")));
        af.getField("amount").setValue(str(v.get("amount")));
        if (Boolean.TRUE.equals(v.get("approved"))) ((org.apache.pdfbox.pdmodel.interactive.form.PDCheckBox) af.getField("approved")).check();
        af.flatten();
        d.save(out);
      }
    }
    public void sign(String file, String out, Cert c) throws Exception {
      var e = p12(c);
      try (var d = load(file); var os = new FileOutputStream(out)) {
        var sig = new org.apache.pdfbox.pdmodel.interactive.digitalsignature.PDSignature();
        sig.setFilter(org.apache.pdfbox.pdmodel.interactive.digitalsignature.PDSignature.FILTER_ADOBE_PPKLITE);
        sig.setSubFilter(org.apache.pdfbox.pdmodel.interactive.digitalsignature.PDSignature.SUBFILTER_ADBE_PKCS7_DETACHED);
        sig.setName("Deep Bench Test Signer");
        sig.setSignDate(Calendar.getInstance());
        d.addSignature(sig, content -> {
          try {
            var gen = new org.bouncycastle.cms.CMSSignedDataGenerator();
            var signer = new org.bouncycastle.operator.jcajce.JcaContentSignerBuilder("SHA256withRSA").build(e.getPrivateKey());
            gen.addSignerInfoGenerator(new org.bouncycastle.cms.jcajce.JcaSignerInfoGeneratorBuilder(
              new org.bouncycastle.operator.jcajce.JcaDigestCalculatorProviderBuilder().build()).build(signer, (X509Certificate) e.getCertificate()));
            gen.addCertificates(new org.bouncycastle.cert.jcajce.JcaCertStore(Arrays.asList(e.getCertificateChain())));
            return gen.generate(new org.bouncycastle.cms.CMSProcessableByteArray(content.readAllBytes()), false).getEncoded();
          } catch (Exception x) { throw new IOException(x); }
        });
        d.saveIncremental(os);
      }
    }
  }

  // ---------------------------------------------------------------- OpenPDF (the LGPL/MPL fork of iText 4)
  static final class OpenPdf extends Lib {
    public String version() { return mavenVersion("com.github.librepdf", "openpdf"); }
    public CanvasFactory canvas() {
      return (out, keys, title, pdfa) -> new Canvas() {
        final com.lowagie.text.Document d = new com.lowagie.text.Document(new com.lowagie.text.Rectangle((float) W, (float) H), 0, 0, 0, 0);
        final com.lowagie.text.pdf.PdfWriter w = com.lowagie.text.pdf.PdfWriter.getInstance(d, new FileOutputStream(out));
        final Map<String, com.lowagie.text.pdf.BaseFont> f = new HashMap<>();
        com.lowagie.text.pdf.PdfContentByte cb;
        boolean started;
        {
          d.addTitle(title);
          for (String k : keys) f.put(k, com.lowagie.text.pdf.BaseFont.createFont(font(k), com.lowagie.text.pdf.BaseFont.IDENTITY_H, com.lowagie.text.pdf.BaseFont.EMBEDDED));
        }
        public void page() throws Exception {
          if (!started) { d.open(); cb = w.getDirectContent(); started = true; }
          else { w.setPageEmpty(false); d.newPage(); }
        }
        public void text(String s, double x, double y, double size, String k, boolean rtl) throws Exception {
          float base = (float) (H - y - 0.8 * size);
          if (rtl) { // OpenPDF shapes Arabic in ColumnText with a right-to-left run direction
            com.lowagie.text.pdf.ColumnText.showTextAligned(cb, com.lowagie.text.Element.ALIGN_LEFT, new com.lowagie.text.Phrase(s, new com.lowagie.text.Font(f.get(k), (float) size)),
              (float) x, base, 0, com.lowagie.text.pdf.PdfWriter.RUN_DIRECTION_RTL, 0);
            return;
          }
          cb.beginText(); cb.setFontAndSize(f.get(k), (float) size); cb.setTextMatrix((float) x, base); cb.showText(s); cb.endText();
        }
        public double width(String s, double size, String k) throws Exception { return f.get(k).getWidthPoint(s, (float) size); }
        public void rect(double x, double y, double ww, double h, String hex) throws Exception {
          cb.setColorFill(color(hex)); cb.rectangle((float) x, (float) (H - y - h), (float) ww, (float) h); cb.fill(); cb.setColorFill(Color.BLACK);
        }
        public void hline(double x1, double x2, double y, double lw, String hex) throws Exception {
          cb.setColorStroke(color(hex)); cb.setLineWidth((float) lw); cb.moveTo((float) x1, (float) (H - y)); cb.lineTo((float) x2, (float) (H - y)); cb.stroke();
        }
        public Object image(String path) throws Exception { return com.lowagie.text.Image.getInstance(path); }
        public void draw(Object img, double x, double y, double ww, double h) throws Exception {
          cb.addImage((com.lowagie.text.Image) img, (float) ww, 0, 0, (float) h, (float) x, (float) (H - y - h));
        }
        public void end() throws Exception { d.close(); }
      };
    }
    public String extract(String file) throws Exception {
      var r = new com.lowagie.text.pdf.PdfReader(file);
      var ex = new com.lowagie.text.pdf.parser.PdfTextExtractor(r);
      StringBuilder b = new StringBuilder();
      for (int i = 1; i <= r.getNumberOfPages(); i++) b.append(ex.getTextFromPage(i)).append('\n');
      r.close();
      return b.toString();
    }
    void copy(List<String> files, String out, int page) throws Exception {
      var d = new com.lowagie.text.Document();
      var c = new com.lowagie.text.pdf.PdfCopy(d, new FileOutputStream(out));
      d.open();
      for (String f : files) {
        var r = new com.lowagie.text.pdf.PdfReader(f);
        for (int i = 1; i <= r.getNumberOfPages(); i++) if (page == 0 || page == i) c.addPage(c.getImportedPage(r, i));
        c.freeReader(r);
        r.close();
      }
      d.close();
    }
    public void merge(List<String> files, String out) throws Exception { copy(files, out, 0); }
    public void split(String file, String dir) throws Exception {
      var r = new com.lowagie.text.pdf.PdfReader(file);
      int n = r.getNumberOfPages();
      r.close();
      for (int i = 1; i <= n; i++) copy(List.of(file), pageFile(dir, i), i);
    }
    public void metadata(String file, String out, String title) throws Exception {
      var r = new com.lowagie.text.pdf.PdfReader(file);
      var st = new com.lowagie.text.pdf.PdfStamper(r, new FileOutputStream(out), '\0', true);
      HashMap<String, String> info = new HashMap<>(r.getInfo());
      info.put("Title", title);
      st.setMoreInfo(info);
      st.close();
    }
    public void form(String file, String out, Map<String, Object> v) throws Exception {
      var r = new com.lowagie.text.pdf.PdfReader(file);
      var st = new com.lowagie.text.pdf.PdfStamper(r, new FileOutputStream(out));
      var af = st.getAcroFields();
      af.setField("name", str(v.get("name")));
      af.setField("amount", str(v.get("amount")));
      if (Boolean.TRUE.equals(v.get("approved"))) af.setField("approved", "Yes");
      st.setFormFlattening(true);
      st.close();
    }
    public void sign(String file, String out, Cert c) throws Exception {
      var e = p12(c);
      var r = new com.lowagie.text.pdf.PdfReader(file);
      var st = com.lowagie.text.pdf.PdfStamper.createSignature(r, new FileOutputStream(out), '\0', null, true);
      var sap = st.getSignatureAppearance();
      sap.setCrypto(e.getPrivateKey(), e.getCertificateChain(), null, com.lowagie.text.pdf.PdfSignatureAppearance.WINCER_SIGNED);
      sap.setVisibleSignature(str(EDIT.get("signField")));
      st.close();
    }
  }

  // ---------------------------------------------------------------- iText 9 core (AGPL; private benchmarking)
  static final class IText extends Lib {
    static { Security.addProvider(new org.bouncycastle.jce.provider.BouncyCastleProvider()); }
    public String version() { return mavenVersion("com.itextpdf", "kernel"); }
    public CanvasFactory canvas() {
      return (out, keys, title, pdfa) -> new Canvas() {
        final com.itextpdf.kernel.pdf.PdfDocument pdf = new com.itextpdf.kernel.pdf.PdfDocument(new com.itextpdf.kernel.pdf.PdfWriter(out));
        final Map<String, com.itextpdf.kernel.font.PdfFont> f = new HashMap<>();
        com.itextpdf.kernel.pdf.PdfPage pg;
        com.itextpdf.kernel.pdf.canvas.PdfCanvas cv;
        {
          pdf.getDocumentInfo().setTitle(title);
          for (String k : keys) f.put(k, com.itextpdf.kernel.font.PdfFontFactory.createFont(font(k), com.itextpdf.io.font.PdfEncodings.IDENTITY_H,
            com.itextpdf.kernel.font.PdfFontFactory.EmbeddingStrategy.PREFER_EMBEDDED));
        }
        public void page() throws Exception {
          if (pg != null) cv.release();
          pg = pdf.addNewPage(new com.itextpdf.kernel.geom.PageSize((float) W, (float) H));
          cv = new com.itextpdf.kernel.pdf.canvas.PdfCanvas(pg);
        }
        public void text(String s, double x, double y, double size, String k, boolean rtl) throws Exception {
          cv.beginText().setFontAndSize(f.get(k), (float) size).moveText(x, H - y - 0.8 * size).showText(s).endText();
        }
        public double width(String s, double size, String k) throws Exception { return f.get(k).getWidth(s, (float) size); }
        com.itextpdf.kernel.colors.DeviceRgb rgb(String hex) { float[] c = Frame.rgb(hex); return new com.itextpdf.kernel.colors.DeviceRgb(c[0], c[1], c[2]); }
        public void rect(double x, double y, double w, double h, String hex) throws Exception {
          cv.saveState().setFillColor(rgb(hex)).rectangle(x, H - y - h, w, h).fill().restoreState();
        }
        public void hline(double x1, double x2, double y, double w, String hex) throws Exception {
          cv.saveState().setStrokeColor(rgb(hex)).setLineWidth((float) w).moveTo(x1, H - y).lineTo(x2, H - y).stroke().restoreState();
        }
        public Object image(String path) throws Exception { return com.itextpdf.io.image.ImageDataFactory.create(path); }
        public void draw(Object img, double x, double y, double w, double h) throws Exception {
          cv.addImageFittedIntoRectangle((com.itextpdf.io.image.ImageData) img, new com.itextpdf.kernel.geom.Rectangle((float) x, (float) (H - y - h), (float) w, (float) h), false);
        }
        public void end() throws Exception { pdf.close(); }
      };
    }
    static com.itextpdf.kernel.pdf.PdfDocument read(String f) throws IOException { return new com.itextpdf.kernel.pdf.PdfDocument(new com.itextpdf.kernel.pdf.PdfReader(f)); }
    public String extract(String file) throws Exception {
      try (var d = read(file)) {
        StringBuilder b = new StringBuilder();
        for (int i = 1; i <= d.getNumberOfPages(); i++) b.append(com.itextpdf.kernel.pdf.canvas.parser.PdfTextExtractor.getTextFromPage(d.getPage(i))).append('\n');
        return b.toString();
      }
    }
    public void merge(List<String> files, String out) throws Exception {
      try (var o = new com.itextpdf.kernel.pdf.PdfDocument(new com.itextpdf.kernel.pdf.PdfWriter(out))) {
        var m = new com.itextpdf.kernel.utils.PdfMerger(o);
        for (String f : files) try (var s = read(f)) { m.merge(s, 1, s.getNumberOfPages()); }
      }
    }
    public void split(String file, String dir) throws Exception {
      try (var s = read(file)) {
        for (int i = 1; i <= s.getNumberOfPages(); i++)
          try (var d = new com.itextpdf.kernel.pdf.PdfDocument(new com.itextpdf.kernel.pdf.PdfWriter(pageFile(dir, i)))) { s.copyPagesTo(i, i, d); }
      }
    }
    public void encrypt(String file, String out, String user, String owner) throws Exception {
      var props = new com.itextpdf.kernel.pdf.WriterProperties().setStandardEncryption(user.getBytes(), owner.getBytes(),
        com.itextpdf.kernel.pdf.EncryptionConstants.ALLOW_PRINTING, com.itextpdf.kernel.pdf.EncryptionConstants.ENCRYPTION_AES_256);
      new com.itextpdf.kernel.pdf.PdfDocument(new com.itextpdf.kernel.pdf.PdfReader(file), new com.itextpdf.kernel.pdf.PdfWriter(out, props)).close();
    }
    public void metadata(String file, String out, String title) throws Exception {
      try (var d = new com.itextpdf.kernel.pdf.PdfDocument(new com.itextpdf.kernel.pdf.PdfReader(file), new com.itextpdf.kernel.pdf.PdfWriter(out),
             new com.itextpdf.kernel.pdf.StampingProperties().useAppendMode())) {
        d.getDocumentInfo().setTitle(title);
      }
    }
    public void form(String file, String out, Map<String, Object> v) throws Exception {
      try (var d = new com.itextpdf.kernel.pdf.PdfDocument(new com.itextpdf.kernel.pdf.PdfReader(file), new com.itextpdf.kernel.pdf.PdfWriter(out))) {
        var af = com.itextpdf.forms.PdfFormCreator.getAcroForm(d, false);
        af.getField("name").setValue(str(v.get("name")));
        af.getField("amount").setValue(str(v.get("amount")));
        if (Boolean.TRUE.equals(v.get("approved"))) af.getField("approved").setValue("Yes");
        af.flattenFields();
      }
    }
    public void sign(String file, String out, Cert c) throws Exception {
      var e = p12(c);
      var signer = new com.itextpdf.signatures.PdfSigner(new com.itextpdf.kernel.pdf.PdfReader(file), new FileOutputStream(out),
        new com.itextpdf.kernel.pdf.StampingProperties().useAppendMode());
      signer.setSignerProperties(new com.itextpdf.signatures.SignerProperties().setFieldName(str(EDIT.get("signField"))));
      Certificate[] chain = e.getCertificateChain();
      signer.signDetached(new com.itextpdf.signatures.BouncyCastleDigest(),
        new com.itextpdf.signatures.PrivateKeySignature(e.getPrivateKey(), com.itextpdf.signatures.DigestAlgorithms.SHA256, "BC"),
        chain, null, null, null, 0, com.itextpdf.signatures.PdfSigner.CryptoStandard.CMS);
    }
  }
}
