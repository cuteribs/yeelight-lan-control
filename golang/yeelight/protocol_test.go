package yeelight

import (
	"reflect"
	"testing"
)

func TestParseDiscoveryResponseExtractsLocationAndSupportedMethods(t *testing.T) {
	raw := []byte("HTTP/1.1 200 OK\r\nid: 0x0000000012345678\r\nLocation: yeelight://192.168.1.5:55443\r\nmodel: color\r\nsupport: get_prop set_power set_bright set_ct_abx\r\nname: QmVkcm9vbQ==\r\npower: on\r\nbright: 75\r\n\r\n")
	device := ParseDiscoveryResponse(raw)
	if device == nil {
		t.Fatal("expected device")
	}
	if device.ID != "0x0000000012345678" || device.Host != "192.168.1.5" || device.Port != 55443 {
		t.Fatalf("unexpected device identity: %#v", device)
	}
	if !reflect.DeepEqual(device.Support, []string{"get_prop", "set_power", "set_bright", "set_ct_abx"}) {
		t.Fatalf("unexpected support: %#v", device.Support)
	}
	if device.Name != "Bedroom" {
		t.Fatalf("unexpected name: %q", device.Name)
	}
}

func TestParseDiscoveryResponseAcceptsYeelightNotifyPackets(t *testing.T) {
	raw := []byte("NOTIFY * HTTP/1.1\r\nHost: 239.255.255.250:1982\r\nLocation: yeelight://192.168.1.9:55443\r\nid: 0x0000000099999999\r\nmodel: mono\r\nsupport: get_prop set_power\r\n\r\n")
	device := ParseDiscoveryResponse(raw)
	if device == nil {
		t.Fatal("expected device")
	}
	if device.Host != "192.168.1.9" || device.Port != 55443 || device.ID != "0x0000000099999999" {
		t.Fatalf("unexpected device: %#v", device)
	}
}

func TestParseDiscoveryHeadersAcceptsUppercaseSSDPHeaderObjects(t *testing.T) {
	device := ParseDiscoveryHeaders(map[string]string{
		"ID":       "0x00000000abcdef01",
		"LOCATION": "yeelight://192.168.1.23:55443",
		"MODEL":    "mono",
		"SUPPORT":  "get_prop set_power set_bright",
		"NAME":     "S2l0Y2hlbg==",
		"POWER":    "off",
		"BRIGHT":   "20",
	})
	if device == nil {
		t.Fatal("expected device")
	}
	if device.ID != "0x00000000abcdef01" || device.Host != "192.168.1.23" || device.Port != 55443 {
		t.Fatalf("unexpected device identity: %#v", device)
	}
	if !reflect.DeepEqual(device.Support, []string{"get_prop", "set_power", "set_bright"}) {
		t.Fatalf("unexpected support: %#v", device.Support)
	}
	if device.Name != "Kitchen" {
		t.Fatalf("unexpected name: %q", device.Name)
	}
}

func TestParseDiscoveryResponseJoinsWrappedSupportHeaders(t *testing.T) {
	raw := []byte("HTTP/1.1 200 OK\r\nLocation: yeelight://192.168.6.193:55443\r\nid: 0x0000000019f583f7\r\nsupport: get_prop set_power\r\n set_ct_abx adjust_ct set_rgb\r\n\r\n")
	device := ParseDiscoveryResponse(raw)
	if device == nil {
		t.Fatal("expected device")
	}
	expected := []string{"get_prop", "set_power", "set_ct_abx", "adjust_ct", "set_rgb"}
	if !reflect.DeepEqual(device.Support, expected) {
		t.Fatalf("unexpected support: %#v", device.Support)
	}
}

func TestSplitSocketBufferPreservesIncompleteTrailingJSON(t *testing.T) {
	lines, pending := SplitSocketBuffer("", "{\"id\":1,\"result\":[\"ok\"]}\r\n{\"id\":2")
	if !reflect.DeepEqual(lines, []string{"{\"id\":1,\"result\":[\"ok\"]}"}) {
		t.Fatalf("unexpected first lines: %#v", lines)
	}
	if pending != "{\"id\":2" {
		t.Fatalf("unexpected first pending: %q", pending)
	}

	lines, pending = SplitSocketBuffer(pending, ",\"result\":[\"ok\"]}\r\n")
	if !reflect.DeepEqual(lines, []string{"{\"id\":2,\"result\":[\"ok\"]}"}) {
		t.Fatalf("unexpected second lines: %#v", lines)
	}
	if pending != "" {
		t.Fatalf("unexpected second pending: %q", pending)
	}
}

func TestBuildCommandAppendsTheYeelightLineDelimiter(t *testing.T) {
	got := BuildCommand("set_power", []any{"on", "sudden", 30}, 7)
	expected := "{\"id\":7,\"method\":\"set_power\",\"params\":[\"on\",\"sudden\",30]}\r\n"
	if got != expected {
		t.Fatalf("unexpected command: %q", got)
	}
}

func TestNormalizeStatusMapsGetPropResultsToPropertyNames(t *testing.T) {
	got := NormalizeStatus([]string{"power", "bright", "ct"}, []string{"on", "50", "3500"})
	if got["power"] == nil || *got["power"] != "on" {
		t.Fatalf("unexpected power: %#v", got["power"])
	}
	if got["bright"] == nil || *got["bright"] != "50" {
		t.Fatalf("unexpected bright: %#v", got["bright"])
	}
	if got["ct"] == nil || *got["ct"] != "3500" {
		t.Fatalf("unexpected ct: %#v", got["ct"])
	}
}

func TestDecodeDeviceNameLeavesPlainTextUnchanged(t *testing.T) {
	if got := DecodeDeviceName("Kitchen"); got != "Kitchen" {
		t.Fatalf("unexpected decoded name: %q", got)
	}
}

func TestValidateRGBValueAcceptsPackedRGBIntegers(t *testing.T) {
	if err := ValidateRGBValue(0xff0000); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateRGBValueRejectsValuesOutside24BitRGBRange(t *testing.T) {
	if err := ValidateRGBValue(0x1000000); err == nil {
		t.Fatal("expected range error")
	}
}

func TestValidateRGBComponentEnforces0255ComponentRange(t *testing.T) {
	if err := ValidateRGBComponent(255, "Red"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if err := ValidateRGBComponent(256, "Red"); err == nil {
		t.Fatal("expected component error")
	}
}
