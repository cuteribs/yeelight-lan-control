package main

import (
	"reflect"
	"testing"

	yeelight "yeelight-cli-go/yeelight"
)

func TestParseArgumentsSeparatesOptionsAndPositionals(t *testing.T) {
	parsed := parseArguments([]string{"status", "--host", "192.168.1.23:55443", "--json", "--timeout", "5000"})
	if !reflect.DeepEqual(parsed.Positionals, []string{"status"}) {
		t.Fatalf("unexpected positionals: %#v", parsed.Positionals)
	}
	if parsed.Options["host"].String != "192.168.1.23:55443" {
		t.Fatalf("unexpected host option: %#v", parsed.Options["host"])
	}
	if !parsed.Options["json"].Bool {
		t.Fatalf("expected json flag, got %#v", parsed.Options["json"])
	}
	if parsed.Options["timeout"].String != "5000" {
		t.Fatalf("unexpected timeout option: %#v", parsed.Options["timeout"])
	}
}

func TestParseArgumentsIgnoresStandaloneGoRunSeparator(t *testing.T) {
	parsed := parseArguments([]string{"--", "probe", "--host", "192.168.1.23:55443"})
	if !reflect.DeepEqual(parsed.Positionals, []string{"probe"}) {
		t.Fatalf("unexpected positionals: %#v", parsed.Positionals)
	}
	if parsed.Options["host"].String != "192.168.1.23:55443" {
		t.Fatalf("unexpected host option: %#v", parsed.Options["host"])
	}
	if _, ok := parsed.Options[""]; ok {
		t.Fatalf("did not expect empty option key: %#v", parsed.Options)
	}
}

func TestParseDeviceSelectorAcceptsHostAndRejectsMultipleSelectors(t *testing.T) {
	selector, err := parseDeviceSelector(map[string]optionValue{
		"host": {String: "192.168.1.23:55443"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if selector.Host != "192.168.1.23" || selector.Port != 55443 {
		t.Fatalf("unexpected selector: %#v", selector)
	}

	_, err = parseDeviceSelector(map[string]optionValue{
		"host": {String: "192.168.1.23"},
		"id":   {String: "0x123"},
	})
	if err == nil || err.Error() != "Use only one device selector: --id, --name, or --host <ip[:port]>." {
		t.Fatalf("expected selector conflict error, got %v", err)
	}
}

func TestParseRGBValueAcceptsHexAndComponents(t *testing.T) {
	hex, err := parseRGBValue([]string{"rgb", "ff0000"})
	if err != nil {
		t.Fatalf("unexpected hex error: %v", err)
	}
	if hex != 0xff0000 {
		t.Fatalf("unexpected hex value: %d", hex)
	}

	packed, err := parseRGBValue([]string{"rgb", "255", "0", "1"})
	if err != nil {
		t.Fatalf("unexpected component error: %v", err)
	}
	expected, _ := yeelight.ToRGBValue(255, 0, 1)
	if packed != expected {
		t.Fatalf("unexpected packed value: %d", packed)
	}
}

func TestParseExecInputSupportsJSONArrayAndPositionalTokens(t *testing.T) {
	method, params, err := parseExecInput(parsedArguments{
		Options:     map[string]optionValue{"params": {String: `["color",65280,70]`}},
		Positionals: []string{"exec", "set_scene"},
	})
	if err != nil {
		t.Fatalf("unexpected params error: %v", err)
	}
	if method != "set_scene" {
		t.Fatalf("unexpected method: %s", method)
	}
	if !reflect.DeepEqual(params, []any{"color", float64(65280), float64(70)}) {
		t.Fatalf("unexpected json params: %#v", params)
	}

	method, params, err = parseExecInput(parsedArguments{
		Options:     map[string]optionValue{},
		Positionals: []string{"exec", "set_power", "on", "smooth", "500"},
	})
	if err != nil {
		t.Fatalf("unexpected positional error: %v", err)
	}
	if method != "set_power" {
		t.Fatalf("unexpected method: %s", method)
	}
	if !reflect.DeepEqual(params, []any{"on", "smooth", float64(500)}) {
		t.Fatalf("unexpected positional params: %#v", params)
	}
}

func TestParseTimeoutAndOptionHelpers(t *testing.T) {
	timeout, err := parseTimeout(map[string]optionValue{"timeout": {String: "5000"}}, 3000)
	if err != nil {
		t.Fatalf("unexpected timeout error: %v", err)
	}
	if timeout != 5000 {
		t.Fatalf("unexpected timeout: %d", timeout)
	}

	if optionString(map[string]optionValue{"host": {String: "192.168.1.23"}}, "host") != "192.168.1.23" {
		t.Fatal("expected host option string")
	}
	if !optionFlag(map[string]optionValue{"json": {Bool: true}}, "json") {
		t.Fatal("expected json flag")
	}
}
