package yeelight

import (
	"reflect"
	"testing"
)

func TestParseExecTokenKeepsPlainStringsAsStrings(t *testing.T) {
	if got := ParseExecToken("set_power"); got != "set_power" {
		t.Fatalf("expected string token, got %#v", got)
	}
	if got := ParseExecToken("on"); got != "on" {
		t.Fatalf("expected string token, got %#v", got)
	}
}

func TestParseExecTokenParsesJSONLikeLiterals(t *testing.T) {
	if got := ParseExecToken("500"); got != float64(500) {
		t.Fatalf("expected 500, got %#v", got)
	}
	if got := ParseExecToken("-20"); got != float64(-20) {
		t.Fatalf("expected -20, got %#v", got)
	}
	if got := ParseExecToken("true"); got != true {
		t.Fatalf("expected true, got %#v", got)
	}
	if got := ParseExecToken(`{"level":1}`); !reflect.DeepEqual(got, map[string]any{"level": float64(1)}) {
		t.Fatalf("unexpected object parse: %#v", got)
	}
	if got := ParseExecToken(`["power","bright"]`); !reflect.DeepEqual(got, []any{"power", "bright"}) {
		t.Fatalf("unexpected array parse: %#v", got)
	}
}

func TestParseExecTokensParsesMixedPositionalParams(t *testing.T) {
	expected := []any{"on", "smooth", float64(500)}
	if got := ParseExecTokens([]string{"on", "smooth", "500"}); !reflect.DeepEqual(got, expected) {
		t.Fatalf("unexpected token parse: %#v", got)
	}
}

func TestParseExecParamsValueRequiresJSONArray(t *testing.T) {
	params, err := ParseExecParamsValue(`["color",65280,70]`)
	if err != nil {
		t.Fatalf("expected array parse to succeed: %v", err)
	}
	expected := []any{"color", float64(65280), float64(70)}
	if !reflect.DeepEqual(params, expected) {
		t.Fatalf("unexpected params: %#v", params)
	}

	if _, err := ParseExecParamsValue(`{"method":"toggle"}`); err == nil || err.Error() != "Exec params must be a JSON array." {
		t.Fatalf("expected non-array error, got %v", err)
	}
}

func TestParseHostValueAcceptsHostWithOptionalPort(t *testing.T) {
	first, err := ParseHostValue("192.168.1.23", 55443)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual(first, HostValue{Host: "192.168.1.23", Port: 55443}) {
		t.Fatalf("unexpected host parse: %#v", first)
	}

	second, err := ParseHostValue("192.168.1.23:12345", 55443)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual(second, HostValue{Host: "192.168.1.23", Port: 12345}) {
		t.Fatalf("unexpected host parse: %#v", second)
	}
}

func TestParseHostValueRejectsInvalidHostForms(t *testing.T) {
	if _, err := ParseHostValue("192.168.1.23:abc", 55443); err == nil || err.Error() != "Host port must be an integer between 1 and 65535." {
		t.Fatalf("expected port error, got %v", err)
	}
	if _, err := ParseHostValue("192.168.1.23:70000", 55443); err == nil || err.Error() != "Host port must be an integer between 1 and 65535." {
		t.Fatalf("expected out-of-range error, got %v", err)
	}
}
