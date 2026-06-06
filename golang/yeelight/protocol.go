package yeelight

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

func IsYeelightMethod(value string) bool {
	for _, method := range YeelightMethods {
		if method == value {
			return true
		}
	}
	return false
}

func BuildDiscoveryRequest() []byte {
	return []byte(strings.Join([]string{
		"M-SEARCH * HTTP/1.1",
		fmt.Sprintf("HOST: %s:%d", DiscoveryAddress, DiscoveryPort),
		"MAN: \"ssdp:discover\"",
		"MX: 2",
		"ST: wifi_bulb",
		"",
		"",
	}, "\r\n"))
}

func ParseDiscoveryHeaders(headers map[string]string) *DiscoveredDevice {
	normalized := make(map[string]string, len(headers))
	for key, value := range headers {
		normalized[strings.ToLower(key)] = strings.TrimSpace(value)
	}

	location := normalized["location"]
	if location == "" || !strings.HasPrefix(location, "yeelight://") {
		return nil
	}

	remainder := strings.TrimPrefix(location, "yeelight://")
	separator := strings.LastIndex(remainder, ":")
	if separator <= 0 || separator == len(remainder)-1 {
		return nil
	}

	host := remainder[:separator]
	portText := remainder[separator+1:]
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return nil
	}

	support := []string{}
	if rawSupport := strings.TrimSpace(normalized["support"]); rawSupport != "" {
		support = strings.Fields(rawSupport)
	}

	id := normalized["id"]
	if id == "" {
		id = fmt.Sprintf("%s:%d", host, port)
	}

	return &DiscoveredDevice{
		ID:               id,
		Host:             host,
		Port:             port,
		Model:            normalized["model"],
		FirmwareVersion:  normalized["fw_ver"],
		Name:             DecodeDeviceName(normalized["name"]),
		Power:            normalized["power"],
		Brightness:       normalized["bright"],
		ColorMode:        normalized["color_mode"],
		ColorTemperature: normalized["ct"],
		RGB:              normalized["rgb"],
		Hue:              normalized["hue"],
		Saturation:       normalized["sat"],
		Support:          support,
		Location:         location,
	}
}

func ParseDiscoveryResponse(message []byte) *DiscoveredDevice {
	raw := string(message)
	lines := strings.Split(raw, "\n")
	headers := map[string]string{}
	var lastKey string

	for _, line := range lines {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}

		separator := strings.Index(line, ":")
		if separator == -1 {
			if lastKey != "" {
				headers[lastKey] = strings.TrimSpace(strings.TrimSpace(headers[lastKey]) + " " + strings.TrimSpace(line))
			}
			continue
		}

		key := strings.ToLower(strings.TrimSpace(line[:separator]))
		value := strings.TrimSpace(line[separator+1:])
		headers[key] = value
		lastKey = key
	}

	return ParseDiscoveryHeaders(headers)
}

func DecodeDeviceName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	for _, char := range trimmed {
		if !(char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '+' || char == '/' || char == '=') {
			return trimmed
		}
	}
	if len(trimmed)%4 != 0 {
		return trimmed
	}

	decoded, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return trimmed
	}

	decodedString := string(decoded)
	if decodedString == "" {
		return trimmed
	}
	for _, char := range decodedString {
		if (char >= 0x00 && char <= 0x08) || (char >= 0x0E && char <= 0x1F) {
			return trimmed
		}
	}

	normalizedInput := strings.TrimRight(trimmed, "=")
	normalizedOutput := strings.TrimRight(base64.StdEncoding.EncodeToString([]byte(decodedString)), "=")
	if normalizedInput == normalizedOutput {
		return decodedString
	}

	return trimmed
}

func BuildCommand(method string, params []any, id uint64) string {
	payload, _ := json.Marshal(map[string]any{
		"id":     id,
		"method": method,
		"params": params,
	})
	return string(payload) + "\r\n"
}

func SplitSocketBuffer(pending, chunk string) ([]string, string) {
	combined := pending + chunk
	parts := strings.Split(combined, "\r\n")
	nextPending := ""
	if len(parts) > 0 {
		nextPending = parts[len(parts)-1]
		parts = parts[:len(parts)-1]
	}

	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		line := strings.TrimSpace(part)
		if line != "" {
			lines = append(lines, line)
		}
	}

	return lines, nextPending
}

func NormalizeStatus(properties []string, result []string) PropertyValues {
	values := make(PropertyValues, len(properties))
	for index, property := range properties {
		if index < len(result) {
			value := result[index]
			values[property] = &value
			continue
		}
		values[property] = nil
	}
	return values
}

func ParseNotificationMessage(message string) (*Notification, error) {
	var payload struct {
		Method string         `json:"method"`
		Params map[string]any `json:"params"`
	}
	if err := json.Unmarshal([]byte(message), &payload); err != nil {
		return nil, err
	}
	if payload.Method != "props" || payload.Params == nil {
		return nil, nil
	}

	params := make(map[string]string, len(payload.Params))
	for key, value := range payload.Params {
		params[key] = valueAsString(value)
	}

	return &Notification{Method: "props", Params: params}, nil
}

func BuildFlowExpression(tuples []FlowTuple) (string, error) {
	if len(tuples) == 0 {
		return "", fmt.Errorf("At least one flow tuple is required.")
	}

	parts := make([]string, 0, len(tuples))
	for _, tuple := range tuples {
		if err := ValidateFlowTuple(tuple); err != nil {
			return "", err
		}
		parts = append(parts, fmt.Sprintf("%d,%d,%d,%d", tuple.Duration, tuple.Mode, tuple.Value, tuple.Brightness))
	}
	return strings.Join(parts, ","), nil
}

func SerializeScene(scene Scene) ([]any, error) {
	switch scene.Class {
	case "color":
		if err := ValidateRGBValue(scene.RGBValue); err != nil {
			return nil, err
		}
		if err := ValidateBrightness(scene.Brightness); err != nil {
			return nil, err
		}
		return []any{"color", scene.RGBValue, scene.Brightness}, nil
	case "hsv":
		if err := ValidateHue(scene.Hue); err != nil {
			return nil, err
		}
		if err := ValidateSaturation(scene.Saturation); err != nil {
			return nil, err
		}
		if err := ValidateBrightness(scene.Brightness); err != nil {
			return nil, err
		}
		return []any{"hsv", scene.Hue, scene.Saturation, scene.Brightness}, nil
	case "ct":
		if err := ValidateColorTemperature(scene.CTValue); err != nil {
			return nil, err
		}
		if err := ValidateBrightness(scene.Brightness); err != nil {
			return nil, err
		}
		return []any{"ct", scene.CTValue, scene.Brightness}, nil
	case "cf":
		if err := ValidateFlowCount(scene.Count); err != nil {
			return nil, err
		}
		if err := ValidateFlowAction(scene.Action); err != nil {
			return nil, err
		}
		flow := scene.FlowExpression.Serialized
		if flow == "" {
			serialized, err := BuildFlowExpression(scene.FlowExpression.Tuples)
			if err != nil {
				return nil, err
			}
			flow = serialized
		}
		return []any{"cf", scene.Count, scene.Action, flow}, nil
	case "auto_delay_off":
		if err := ValidateBrightness(scene.Brightness); err != nil {
			return nil, err
		}
		if err := ValidatePositiveInteger(scene.Minutes, "Auto-delay minutes"); err != nil {
			return nil, err
		}
		return []any{"auto_delay_off", scene.Brightness, scene.Minutes}, nil
	default:
		return nil, fmt.Errorf("Unsupported scene class %q.", scene.Class)
	}
}

func ValidateEffect(effect string) error {
	if effect != "sudden" && effect != "smooth" {
		return fmt.Errorf("Effect must be \"sudden\" or \"smooth\".")
	}
	return nil
}

func ValidateDuration(duration, minimum int) error {
	if duration < minimum {
		return fmt.Errorf("Duration must be an integer greater than or equal to %d milliseconds.", minimum)
	}
	return nil
}

func ValidateBrightness(brightness int) error {
	if brightness < 1 || brightness > 100 {
		return fmt.Errorf("Brightness must be an integer between 1 and 100.")
	}
	return nil
}

func ValidateColorTemperature(colorTemperature int) error {
	if colorTemperature < 1700 || colorTemperature > 6500 {
		return fmt.Errorf("Color temperature must be an integer between 1700 and 6500 Kelvin.")
	}
	return nil
}

func ValidateRGBValue(rgbValue int) error {
	if rgbValue < 0 || rgbValue > 0x00ffffff {
		return fmt.Errorf("RGB color must be an integer between 0 and 16777215.")
	}
	return nil
}

func ValidateRGBComponent(component int, label string) error {
	if component < 0 || component > 255 {
		return fmt.Errorf("%s must be an integer between 0 and 255.", label)
	}
	return nil
}

func ValidateHue(hue int) error {
	if hue < 0 || hue > 359 {
		return fmt.Errorf("Hue must be an integer between 0 and 359.")
	}
	return nil
}

func ValidateSaturation(saturation int) error {
	if saturation < 0 || saturation > 100 {
		return fmt.Errorf("Saturation must be an integer between 0 and 100.")
	}
	return nil
}

func ValidatePowerMode(mode int) error {
	if mode < 0 || mode > 5 {
		return fmt.Errorf("Power mode must be an integer between 0 and 5.")
	}
	return nil
}

func ValidatePercentage(percentage int) error {
	if percentage < -100 || percentage > 100 {
		return fmt.Errorf("Percentage must be an integer between -100 and 100.")
	}
	return nil
}

func ValidateName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("Device name must not be empty.")
	}
	if len(name) > 64 {
		return fmt.Errorf("Device name must be 64 bytes or fewer.")
	}
	return nil
}

func ValidateCronType(value int) error {
	if value != 0 {
		return fmt.Errorf("Cron type must be 0 according to the Yeelight spec.")
	}
	return nil
}

func ValidateAdjustAction(action string) error {
	if action != "increase" && action != "decrease" && action != "circle" {
		return fmt.Errorf("Adjust action must be \"increase\", \"decrease\", or \"circle\".")
	}
	return nil
}

func ValidateAdjustProperty(property string) error {
	if property != "bright" && property != "ct" && property != "color" {
		return fmt.Errorf("Adjust property must be \"bright\", \"ct\", or \"color\".")
	}
	return nil
}

func ValidateFlowAction(action int) error {
	if action < 0 || action > 2 {
		return fmt.Errorf("Flow action must be 0, 1, or 2.")
	}
	return nil
}

func ValidateFlowCount(count int) error {
	if count < 0 {
		return fmt.Errorf("Flow count must be zero or a positive integer.")
	}
	return nil
}

func ValidateFlowTuple(tuple FlowTuple) error {
	if err := ValidateDuration(tuple.Duration, 50); err != nil {
		return err
	}
	switch tuple.Mode {
	case 1:
		if err := ValidateRGBValue(tuple.Value); err != nil {
			return err
		}
	case 2:
		if err := ValidateColorTemperature(tuple.Value); err != nil {
			return err
		}
	case 7:
	default:
		return fmt.Errorf("Flow tuple mode must be 1 (rgb), 2 (ct), or 7 (sleep).")
	}

	if tuple.Mode != 7 && tuple.Brightness != -1 {
		if tuple.Brightness < 1 || tuple.Brightness > 100 {
			return fmt.Errorf("Brightness must be an integer between 1 and 100.")
		}
	}
	return nil
}

func ValidateMusicStart(host string, port int) error {
	if strings.TrimSpace(host) == "" {
		return fmt.Errorf("Music mode host must not be empty.")
	}
	return ValidatePositiveInteger(port, "Music mode port")
}

func ValidatePositiveInteger(value int, label string) error {
	if value <= 0 {
		return fmt.Errorf("%s must be a positive integer.", label)
	}
	return nil
}

func FormatDeviceLabel(device DiscoveredDevice) string {
	title := ""
	if device.Name != "" {
		title = device.Name
	} else if device.ID != "" {
		title = device.ID
	} else {
		title = fmt.Sprintf("%s:%d", device.Host, device.Port)
	}
	return fmt.Sprintf("%s (%s:%d)", title, device.Host, device.Port)
}

func FormatDeviceSummary(device DiscoveredDevice) string {
	name := device.Name
	if name == "" {
		name = "(unnamed)"
	}
	support := "unknown"
	if len(device.Support) > 0 {
		support = strings.Join(device.Support, ", ")
	}
	model := device.Model
	if model == "" {
		model = "unknown"
	}
	power := device.Power
	if power == "" {
		power = "unknown"
	}
	brightness := device.Brightness
	if brightness == "" {
		brightness = "unknown"
	}

	return strings.Join([]string{
		fmt.Sprintf("%s - %s", name, device.ID),
		fmt.Sprintf("  host: %s:%d", device.Host, device.Port),
		fmt.Sprintf("  model: %s", model),
		fmt.Sprintf("  power: %s", power),
		fmt.Sprintf("  brightness: %s", brightness),
		fmt.Sprintf("  support: %s", support),
	}, "\n")
}

func ToRGBValue(red, green, blue int) (int, error) {
	if err := ValidateRGBComponent(red, "Red"); err != nil {
		return 0, err
	}
	if err := ValidateRGBComponent(green, "Green"); err != nil {
		return 0, err
	}
	if err := ValidateRGBComponent(blue, "Blue"); err != nil {
		return 0, err
	}
	return (red << 16) | (green << 8) | blue, nil
}

func FormatRGBHex(rgbValue int) (string, error) {
	if err := ValidateRGBValue(rgbValue); err != nil {
		return "", err
	}
	return fmt.Sprintf("#%06X", rgbValue), nil
}

func SortedSupportedMethods(supported []string) []string {
	clone := append([]string(nil), supported...)
	sort.Strings(clone)
	return clone
}

func valueAsString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case nil:
		return "null"
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		payload, _ := json.Marshal(typed)
		return string(payload)
	}
}
