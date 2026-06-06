package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	yeelight "yeelight-cli-go/yeelight"
)

type optionValue struct {
	Bool   bool
	String string
}

type parsedArguments struct {
	Options     map[string]optionValue
	Positionals []string
}

type resolvedTarget struct {
	Client    *yeelight.Client
	Device    yeelight.DiscoveredDevice
	Duration  int
	Effect    string
	JSON      bool
	TimeoutMS int
}

type deviceSelector struct {
	Host string
	ID   string
	Name string
	Port int
}

func main() {
	os.Exit(run())
}

func run() int {
	parsed := parseArguments(os.Args[1:])
	command := "help"
	if len(parsed.Positionals) > 0 {
		command = parsed.Positionals[0]
	}

	var code int
	var err error
	switch command {
	case "help", "--help":
		printHelp()
		return 0
	case "discover":
		err = handleDiscover(parsed.Options)
	case "status":
		err = handleStatus(parsed.Options)
	case "on":
		err = handlePower("on", parsed.Options)
	case "off":
		err = handlePower("off", parsed.Options)
	case "bright":
		err = handleBrightness(parsed)
	case "ct":
		err = handleColorTemperature(parsed)
	case "rgb":
		err = handleRGB(parsed)
	case "exec":
		code, err = handleExec(parsed)
	case "probe":
		err = handleProbe(parsed.Options)
	default:
		err = fmt.Errorf("Unknown command %q. Run \"go run . -- help\" for usage.", command)
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		if code == 0 {
			return 1
		}
		return code
	}
	if code == 0 {
		return 0
	}
	return code
}

func parseArguments(argv []string) parsedArguments {
	positionals := []string{}
	options := map[string]optionValue{}
	for index := 0; index < len(argv); index++ {
		token := argv[index]
		if token == "--" {
			continue
		}
		if !strings.HasPrefix(token, "--") {
			positionals = append(positionals, token)
			continue
		}

		key := strings.TrimPrefix(token, "--")
		if index+1 < len(argv) && !strings.HasPrefix(argv[index+1], "--") {
			options[key] = optionValue{String: argv[index+1]}
			index++
			continue
		}
		options[key] = optionValue{Bool: true}
	}
	return parsedArguments{Options: options, Positionals: positionals}
}

func handleDiscover(options map[string]optionValue) error {
	timeoutMS, err := parseTimeout(options, yeelight.DefaultDiscoveryTimeout)
	if err != nil {
		return err
	}
	devices, err := yeelight.DiscoverDevices(yeelight.DiscoveryOptions{TimeoutMS: timeoutMS})
	if err != nil {
		return err
	}
	if len(devices) == 0 {
		return fmt.Errorf("No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network.")
	}
	if err := yeelight.WriteDiscoveryCache(devices); err != nil {
		return err
	}
	if optionFlag(options, "json") {
		return printJSON(devices)
	}
	fmt.Printf("Found %d device(s):\n", len(devices))
	for _, device := range devices {
		fmt.Println(yeelight.FormatDeviceSummary(device))
	}
	return nil
}

func handleStatus(options map[string]optionValue) error {
	resolved, err := resolveTarget(options)
	if err != nil {
		return err
	}
	status, err := resolved.Client.GetStatus(yeelight.CommandOptions{TimeoutMS: resolved.TimeoutMS})
	if err != nil {
		return err
	}
	payload := map[string]any{"device": resolved.Device, "status": status}
	if resolved.JSON {
		return printJSON(payload)
	}
	fmt.Printf("Status for %s\n", yeelight.FormatDeviceLabel(resolved.Device))
	for _, key := range yeelight.LiveStatusProperties {
		value := "null"
		if status[key] != nil {
			value = *status[key]
		}
		fmt.Printf("  %s: %s\n", key, value)
	}
	return nil
}

func handlePower(state string, options map[string]optionValue) error {
	resolved, err := resolveTarget(options)
	if err != nil {
		return err
	}
	_, err = resolved.Client.SetPower(state, yeelight.TransitionOptions{
		TimeoutMS: resolved.TimeoutMS,
		Duration:  resolved.Duration,
		Effect:    resolved.Effect,
	})
	if err != nil {
		return err
	}
	payload := map[string]any{"device": resolved.Device, "power": state}
	if resolved.JSON {
		return printJSON(payload)
	}
	fmt.Printf("Set power %s for %s.\n", state, yeelight.FormatDeviceLabel(resolved.Device))
	return nil
}

func handleBrightness(parsed parsedArguments) error {
	if len(parsed.Positionals) < 2 {
		return fmt.Errorf("Brightness value is required. Example: go run . -- bright 40 --id 0x...")
	}
	brightness, err := parseInteger(parsed.Positionals[1], "Brightness")
	if err != nil {
		return err
	}
	resolved, err := resolveTarget(parsed.Options)
	if err != nil {
		return err
	}
	_, err = resolved.Client.SetBrightness(brightness, yeelight.TransitionOptions{TimeoutMS: resolved.TimeoutMS, Duration: resolved.Duration, Effect: resolved.Effect})
	if err != nil {
		return err
	}
	payload := map[string]any{"brightness": brightness, "device": resolved.Device}
	if resolved.JSON {
		return printJSON(payload)
	}
	fmt.Printf("Set brightness to %d for %s.\n", brightness, yeelight.FormatDeviceLabel(resolved.Device))
	return nil
}

func handleColorTemperature(parsed parsedArguments) error {
	if len(parsed.Positionals) < 2 {
		return fmt.Errorf("Color temperature value is required. Example: go run . -- ct 3500 --id 0x...")
	}
	colorTemperature, err := parseInteger(parsed.Positionals[1], "Color temperature")
	if err != nil {
		return err
	}
	resolved, err := resolveTarget(parsed.Options)
	if err != nil {
		return err
	}
	_, err = resolved.Client.SetColorTemperature(colorTemperature, yeelight.TransitionOptions{TimeoutMS: resolved.TimeoutMS, Duration: resolved.Duration, Effect: resolved.Effect})
	if err != nil {
		return err
	}
	payload := map[string]any{"colorTemperature": colorTemperature, "device": resolved.Device}
	if resolved.JSON {
		return printJSON(payload)
	}
	fmt.Printf("Set color temperature to %dK for %s.\n", colorTemperature, yeelight.FormatDeviceLabel(resolved.Device))
	return nil
}

func handleRGB(parsed parsedArguments) error {
	rgbValue, err := parseRGBValue(parsed.Positionals)
	if err != nil {
		return err
	}
	resolved, err := resolveTarget(parsed.Options)
	if err != nil {
		return err
	}
	_, err = resolved.Client.SetRGB(rgbValue, yeelight.TransitionOptions{TimeoutMS: resolved.TimeoutMS, Duration: resolved.Duration, Effect: resolved.Effect})
	if err != nil {
		return err
	}
	hex, err := yeelight.FormatRGBHex(rgbValue)
	if err != nil {
		return err
	}
	payload := map[string]any{"device": resolved.Device, "rgb": rgbValue, "hex": hex}
	if resolved.JSON {
		return printJSON(payload)
	}
	fmt.Printf("Set RGB color to %s for %s.\n", hex, yeelight.FormatDeviceLabel(resolved.Device))
	return nil
}

func handleExec(parsed parsedArguments) (int, error) {
	method, params, err := parseExecInput(parsed)
	if err != nil {
		return 0, err
	}
	resolved, err := resolveTarget(parsed.Options)
	if err != nil {
		return 0, err
	}
	response, err := resolved.Client.SendRawCommand(method, params, yeelight.CommandOptions{TimeoutMS: resolved.TimeoutMS})
	if err != nil {
		return 0, err
	}
	payload := map[string]any{
		"device":   resolved.Device,
		"method":   method,
		"params":   params,
		"response": response,
	}
	if err := printJSON(payload); err != nil {
		return 0, err
	}
	if response.Error != nil {
		return 1, nil
	}
	return 0, nil
}

func handleProbe(options map[string]optionValue) error {
	device, err := resolveProbeDevice(options)
	if err != nil {
		return err
	}
	supported := append([]string(nil), device.Support...)
	sort.Strings(supported)
	unsupportedKnown := []string{}
	for _, method := range yeelight.YeelightMethods {
		found := false
		for _, supportedMethod := range supported {
			if supportedMethod == method {
				found = true
				break
			}
		}
		if !found {
			unsupportedKnown = append(unsupportedKnown, method)
		}
	}
	advertisedUnknown := []string{}
	for _, method := range supported {
		if !yeelight.IsYeelightMethod(method) {
			advertisedUnknown = append(advertisedUnknown, method)
		}
	}
	payload := map[string]any{
		"advertisedUnknown": advertisedUnknown,
		"device":            device,
		"supported":         supported,
		"unsupportedKnown":  unsupportedKnown,
	}
	if optionFlag(options, "json") {
		return printJSON(payload)
	}
	fmt.Printf("Supported methods for %s (%d):\n", yeelight.FormatDeviceLabel(device), len(device.Support))
	for _, method := range supported {
		fmt.Printf("  %s\n", method)
	}
	if len(advertisedUnknown) > 0 {
		fmt.Println()
		fmt.Println("Advertised methods not recognized by this library:")
		for _, method := range advertisedUnknown {
			fmt.Printf("  %s\n", method)
		}
	}
	fmt.Println()
	fmt.Printf("Known Yeelight methods not advertised by this device (%d):\n", len(unsupportedKnown))
	for _, method := range unsupportedKnown {
		fmt.Printf("  %s\n", method)
	}
	return nil
}

func resolveTarget(options map[string]optionValue) (resolvedTarget, error) {
	timeoutMS, err := parseTimeout(options, yeelight.DefaultCommandTimeout)
	if err != nil {
		return resolvedTarget{}, err
	}
	duration := yeelight.DefaultDuration
	if value := optionString(options, "duration"); value != "" {
		duration, err = parseInteger(value, "Duration")
		if err != nil {
			return resolvedTarget{}, err
		}
	}
	effect := optionString(options, "effect")
	if effect == "" {
		effect = yeelight.DefaultEffect
	}
	jsonOutput := optionFlag(options, "json")
	selector, err := parseDeviceSelector(options)
	if err != nil {
		return resolvedTarget{}, err
	}

	if selector.Host != "" {
		device := createDirectHostDevice(selector.Host, selector.Port)
		if !optionFlag(options, "refresh") {
			if cached, ok, err := yeelight.ReadDiscoveryCache(0); err == nil && ok {
				for _, item := range cached {
					if item.Host == selector.Host && item.Port == selector.Port {
						device = item
						break
					}
				}
			}
		}
		return resolvedTarget{
			Client:    yeelight.NewClientFromDevice(device, timeoutMS),
			Device:    device,
			Duration:  duration,
			Effect:    effect,
			JSON:      jsonOutput,
			TimeoutMS: timeoutMS,
		}, nil
	}

	devices, err := getKnownDevices(options)
	if err != nil {
		return resolvedTarget{}, err
	}
	matches := []yeelight.DiscoveredDevice{}
	for _, device := range devices {
		if selector.ID != "" && device.ID == selector.ID {
			matches = append(matches, device)
		}
		if selector.Name != "" && device.Name == selector.Name {
			matches = append(matches, device)
		}
	}
	if len(matches) == 0 {
		return resolvedTarget{}, fmt.Errorf("No discovered Yeelight device matched the provided selector.")
	}
	if len(matches) > 1 {
		choices := []string{}
		for _, device := range matches {
			choices = append(choices, fmt.Sprintf("- %s [id=%s]", yeelight.FormatDeviceLabel(device), device.ID))
		}
		return resolvedTarget{}, fmt.Errorf("Multiple bulbs matched. Re-run with --id, --name, or --host to choose one:\n%s", strings.Join(choices, "\n"))
	}
	device := matches[0]
	return resolvedTarget{
		Client:    yeelight.NewClientFromDevice(device, timeoutMS),
		Device:    device,
		Duration:  duration,
		Effect:    effect,
		JSON:      jsonOutput,
		TimeoutMS: timeoutMS,
	}, nil
}

func getKnownDevices(options map[string]optionValue) ([]yeelight.DiscoveredDevice, error) {
	if !optionFlag(options, "refresh") {
		if cached, ok, err := yeelight.ReadDiscoveryCache(0); err == nil && ok && len(cached) > 0 {
			return cached, nil
		}
	}
	timeoutMS, err := parseTimeout(options, yeelight.DefaultDiscoveryTimeout)
	if err != nil {
		return nil, err
	}
	devices, err := yeelight.DiscoverDevices(yeelight.DiscoveryOptions{TimeoutMS: timeoutMS})
	if err != nil {
		return nil, err
	}
	if len(devices) == 0 {
		return nil, fmt.Errorf("No Yeelight devices found. Ensure LAN control is enabled in the Yeelight app and the bulb is on the same network.")
	}
	if err := yeelight.WriteDiscoveryCache(devices); err != nil {
		return nil, err
	}
	return devices, nil
}

func resolveProbeDevice(options map[string]optionValue) (yeelight.DiscoveredDevice, error) {
	resolved, err := resolveTarget(options)
	if err != nil {
		return yeelight.DiscoveredDevice{}, err
	}
	if len(resolved.Device.Support) > 0 {
		return resolved.Device, nil
	}
	devices, err := getKnownDevices(options)
	if err != nil {
		return yeelight.DiscoveredDevice{}, err
	}
	for _, device := range devices {
		if device.Host == resolved.Device.Host && device.Port == resolved.Device.Port {
			return device, nil
		}
	}
	return yeelight.DiscoveredDevice{}, fmt.Errorf("Unable to determine the supported method list for the selected device. Run discover first or use --refresh.")
}

func parseDeviceSelector(options map[string]optionValue) (deviceSelector, error) {
	if _, exists := options["port"]; exists {
		return deviceSelector{}, fmt.Errorf("Use --host <ip[:port]> instead of --port.")
	}
	hostValue := optionString(options, "host")
	id := optionString(options, "id")
	name := optionString(options, "name")
	selectorCount := 0
	if hostValue != "" {
		selectorCount++
	}
	if id != "" {
		selectorCount++
	}
	if name != "" {
		selectorCount++
	}
	if selectorCount == 0 {
		return deviceSelector{}, fmt.Errorf("This command requires a device selector. Use exactly one of --id, --name, or --host <ip[:port]>.")
	}
	if selectorCount > 1 {
		return deviceSelector{}, fmt.Errorf("Use only one device selector: --id, --name, or --host <ip[:port]>.")
	}
	if hostValue != "" {
		host, err := yeelight.ParseHostValue(hostValue, yeelight.DefaultControlPort)
		if err != nil {
			return deviceSelector{}, err
		}
		return deviceSelector{Host: host.Host, Port: host.Port}, nil
	}
	return deviceSelector{ID: id, Name: name, Port: yeelight.DefaultControlPort}, nil
}

func parseRGBValue(positionals []string) (int, error) {
	values := positionals[1:]
	if len(values) == 1 {
		normalized := strings.TrimSpace(values[0])
		normalized = strings.TrimPrefix(normalized, "#")
		normalized = strings.TrimPrefix(strings.TrimPrefix(normalized, "0x"), "0X")
		if len(normalized) != 6 {
			return 0, fmt.Errorf("RGB color must be \"#RRGGBB\", \"RRGGBB\", \"0xRRGGBB\", or three integers like \"255 0 0\".")
		}
		for _, char := range normalized {
			if !(char >= '0' && char <= '9' || char >= 'a' && char <= 'f' || char >= 'A' && char <= 'F') {
				return 0, fmt.Errorf("RGB color must be \"#RRGGBB\", \"RRGGBB\", \"0xRRGGBB\", or three integers like \"255 0 0\".")
			}
		}
		parsed, err := strconv.ParseInt(normalized, 16, 32)
		if err != nil {
			return 0, err
		}
		return int(parsed), nil
	}
	if len(values) == 3 {
		red, err := parseInteger(values[0], "Red")
		if err != nil {
			return 0, err
		}
		green, err := parseInteger(values[1], "Green")
		if err != nil {
			return 0, err
		}
		blue, err := parseInteger(values[2], "Blue")
		if err != nil {
			return 0, err
		}
		if err := yeelight.ValidateRGBComponent(red, "Red"); err != nil {
			return 0, err
		}
		if err := yeelight.ValidateRGBComponent(green, "Green"); err != nil {
			return 0, err
		}
		if err := yeelight.ValidateRGBComponent(blue, "Blue"); err != nil {
			return 0, err
		}
		return yeelight.ToRGBValue(red, green, blue)
	}
	return 0, fmt.Errorf("RGB color is required. Example: go run . -- rgb ff0000 --id 0x... or go run . -- rgb 255 0 0 --name Bedroom")
}

func parseExecInput(parsed parsedArguments) (string, []any, error) {
	if len(parsed.Positionals) < 2 {
		return "", nil, fmt.Errorf("A Yeelight method is required. Example: go run . -- exec set_power on smooth 500 --id 0x...")
	}
	method := parsed.Positionals[1]
	if paramsValue := optionString(parsed.Options, "params"); paramsValue != "" {
		if len(parsed.Positionals) > 2 {
			return "", nil, fmt.Errorf("Use either positional exec params or --params <json-array>, not both.")
		}
		params, err := yeelight.ParseExecParamsValue(paramsValue)
		if err != nil {
			return "", nil, err
		}
		return method, params, nil
	}
	return method, yeelight.ParseExecTokens(parsed.Positionals[2:]), nil
}

func createDirectHostDevice(host string, port int) yeelight.DiscoveredDevice {
	return yeelight.DiscoveredDevice{
		ID:               host,
		Host:             host,
		Port:             port,
		Model:            "",
		FirmwareVersion:  "",
		Name:             "",
		Power:            "",
		Brightness:       "",
		ColorMode:        "",
		ColorTemperature: "",
		RGB:              "",
		Hue:              "",
		Saturation:       "",
		Support:          []string{},
		Location:         fmt.Sprintf("yeelight://%s:%d", host, port),
	}
}

func parseTimeout(options map[string]optionValue, fallback int) (int, error) {
	if value := optionString(options, "timeout"); value != "" {
		timeout, err := parseInteger(value, "Timeout")
		if err != nil {
			return 0, err
		}
		if timeout < 1 {
			return 0, fmt.Errorf("Timeout must be greater than zero.")
		}
		return timeout, nil
	}
	return fallback, nil
}

func parseInteger(value, label string) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer.", label)
	}
	return parsed, nil
}

func optionString(options map[string]optionValue, key string) string {
	value, ok := options[key]
	if !ok {
		return ""
	}
	return value.String
}

func optionFlag(options map[string]optionValue, key string) bool {
	value, ok := options[key]
	return ok && (value.Bool || value.String != "")
}

func printHelp() {
	lines := []string{
		"Yeelight CLI for Go",
		"",
		"Usage:",
		"  go run . -- <command> [options]",
		"",
		"Commands:",
		"  discover                 Discover bulbs on the LAN",
		"  status                   Read live bulb properties (requires a selector)",
		"  on                       Turn the bulb on (requires a selector)",
		"  off                      Turn the bulb off (requires a selector)",
		"  bright <1-100>           Set brightness (requires a selector)",
		"  ct <1700-6500>           Set color temperature (requires a selector)",
		"  rgb <hex|r g b>          Set RGB color (requires a selector)",
		"  exec <method> [params]   Execute a raw command (requires a selector)",
		"  probe                    List supported methods (requires a selector)",
		"  help                     Show this help",
		"",
		"Common options:",
		"  --id <deviceId>          Target a discovered bulb by device id",
		"  --name <label>           Target a discovered bulb by decoded name",
		"  --host <ip[:port]>       Target a bulb directly by IP, optionally with port",
		"  --timeout <ms>           Timeout override",
		"  --refresh                Force fresh discovery instead of cache",
		"  --json                   Print JSON output",
		"  --params <json-array>    Use a JSON array for exec parameters",
		"  --effect <mode>          sudden or smooth",
		"  --duration <ms>          Duration for write commands (default: 30)",
		"",
		"Exec examples:",
		"  go run . -- exec toggle --id 0x0000000012345678",
		"  go run . -- exec set_power on smooth 500 --host 192.168.1.23:55443",
		"  go run . -- exec get_prop power bright --name Bedroom",
		"  go run . -- exec set_scene --params [\"color\",65280,70] --id 0x0000000012345678",
		"  go run . -- probe --host 192.168.1.23:55443",
		"",
		fmt.Sprintf("Discovery cache: %s", yeelight.GetCachePath()),
	}
	fmt.Println(strings.Join(lines, "\n"))
}

func printJSON(value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(raw))
	return nil
}
