//go:build windows

package main

import (
	"fmt"
	"strings"
	"syscall"
	"unsafe"
)

var (
	winspool         = syscall.NewLazyDLL("winspool.drv")
	procEnumPrinters = winspool.NewProc("EnumPrintersW")
	procOpenPrinter  = winspool.NewProc("OpenPrinterW")
	procClosePrinter = winspool.NewProc("ClosePrinter")
	procStartDoc     = winspool.NewProc("StartDocPrinterW")
	procEndDoc       = winspool.NewProc("EndDocPrinter")
	procStartPage    = winspool.NewProc("StartPagePrinter")
	procEndPage      = winspool.NewProc("EndPagePrinter")
	procWritePrinter = winspool.NewProc("WritePrinter")
)

const printerEnumLocal = 0x2

// PRINTER_INFO_2W (winspool.h)
type printerInfo2 struct {
	pServerName, pPrinterName, pShareName, pPortName, pDriverName *uint16
	pComment, pLocation                                           *uint16
	pDevMode                                                      uintptr
	pSepFile, pPrintProcessor, pDatatype, pParameters             *uint16
	pSecurityDescriptor                                           uintptr
	attributes, priority, defaultPriority, startTime, untilTime   uint32
	status, cJobs, averagePPM                                     uint32
}

type docInfo1 struct {
	pDocName, pOutputFile, pDatatype *uint16
}

func utf16At(p *uint16) string {
	if p == nil {
		return ""
	}
	// Walk to the NUL ourselves: slicing a fixed-size array view would claim
	// memory past the spooler buffer.
	n := 0
	for *(*uint16)(unsafe.Add(unsafe.Pointer(p), n*2)) != 0 {
		n++
	}
	return syscall.UTF16ToString(unsafe.Slice(p, n))
}

// listPrinters enumerates local spooler queues. Unless all is set, only queues
// on a USB port are returned (USB001…), which is where a plugged-in cutter lands.
func listPrinters(all bool) ([]printerInfo, error) {
	var needed, returned uint32
	// First call sizes the buffer; it is expected to fail with "insufficient buffer".
	procEnumPrinters.Call(printerEnumLocal, 0, 2, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if needed == 0 {
		return nil, nil
	}
	buf := make([]byte, needed)
	r, _, err := procEnumPrinters.Call(printerEnumLocal, 0, 2, uintptr(unsafe.Pointer(&buf[0])), uintptr(needed),
		uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if r == 0 {
		return nil, err
	}
	size := unsafe.Sizeof(printerInfo2{})
	var out []printerInfo
	for i := uintptr(0); i < uintptr(returned); i++ {
		pi := (*printerInfo2)(unsafe.Pointer(&buf[i*size]))
		port := utf16At(pi.pPortName)
		isUSB := strings.HasPrefix(strings.ToUpper(port), "USB")
		if !all && !isUSB {
			continue
		}
		out = append(out, printerInfo{
			Name: utf16At(pi.pPrinterName), Port: port, Driver: utf16At(pi.pDriverName),
			IsUSB: isUSB, Kind: "spooler",
		})
	}
	return out, nil
}

func writePrinterRaw(name string, data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}
	namePtr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, err
	}
	var h syscall.Handle
	if r, _, e := procOpenPrinter.Call(uintptr(unsafe.Pointer(namePtr)), uintptr(unsafe.Pointer(&h)), 0); r == 0 {
		return 0, fmt.Errorf("cannot open printer %q: %v", name, e)
	}
	defer procClosePrinter.Call(uintptr(h))

	docName, _ := syscall.UTF16PtrFromString("OmniPlot cut")
	raw, _ := syscall.UTF16PtrFromString("RAW") // bypass the driver: HPGL goes straight to the cutter
	di := docInfo1{pDocName: docName, pDatatype: raw}
	if job, _, e := procStartDoc.Call(uintptr(h), 1, uintptr(unsafe.Pointer(&di))); job == 0 {
		return 0, fmt.Errorf("cannot start print job on %q: %v", name, e)
	}
	// Whatever happens below, close the document so the job isn't left stuck.
	defer procEndDoc.Call(uintptr(h))
	if r, _, e := procStartPage.Call(uintptr(h)); r == 0 {
		return 0, fmt.Errorf("cannot start page on %q: %v", name, e)
	}
	defer procEndPage.Call(uintptr(h))

	total := 0
	for total < len(data) {
		var written uint32
		chunk := data[total:]
		if r, _, e := procWritePrinter.Call(uintptr(h), uintptr(unsafe.Pointer(&chunk[0])), uintptr(len(chunk)), uintptr(unsafe.Pointer(&written))); r == 0 {
			return total, fmt.Errorf("write error after %d bytes on %q: %v", total, name, e)
		}
		if written == 0 {
			return total, fmt.Errorf("printer %q accepted 0 bytes after %d", name, total)
		}
		total += int(written)
	}
	return total, nil
}
