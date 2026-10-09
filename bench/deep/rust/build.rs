// The contestants' resolved versions from Cargo.lock, for the "version" job.
fn main() {
    println!("cargo:rerun-if-changed=Cargo.lock");
    let lock = std::fs::read_to_string("Cargo.lock").unwrap_or_default();
    for (name, var) in [("printpdf", "V_PRINTPDF"), ("lopdf", "V_LOPDF"), ("pdf-extract", "V_PDF_EXTRACT")] {
        let mut v = "?".to_string();
        let mut blocks = lock.split("[[package]]");
        // the first matching block wins; lopdf may appear twice (pdf-extract and printpdf pull their own): ours is the =pin
        while let Some(b) = blocks.next() {
            if b.contains(&format!("name = \"{}\"\n", name)) {
                if let Some(line) = b.lines().find(|l| l.starts_with("version = ")) {
                    let found = line.trim_start_matches("version = ").trim_matches('"').to_string();
                    if name != "lopdf" || found == "0.45.0" || v == "?" {
                        v = found;
                    }
                }
            }
        }
        println!("cargo:rustc-env={}={}", var, v);
    }
}
