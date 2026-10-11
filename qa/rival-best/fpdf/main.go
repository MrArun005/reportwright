// fpdf's showcase: fast plain text in a core font (no embedding).
package main

import (
	"fmt"
	"os"

	"github.com/go-pdf/fpdf"
)

func main() {
	p := fpdf.New("P", "pt", "A4", "")
	p.SetFont("Helvetica", "", 10)
	for pg := 0; pg < 200; pg++ {
		p.AddPage()
		for l := 0; l < 60; l++ {
			p.Text(40, float64(50+l*12), fmt.Sprintf("Page %d line %d: the quick brown fox jumps over the lazy dog 0123456789", pg+1, l+1))
		}
	}
	if err := p.OutputFileAndClose(os.Args[1]); err != nil {
		panic(err)
	}
}
