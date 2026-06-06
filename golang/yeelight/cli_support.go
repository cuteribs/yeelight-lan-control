package yeelight

import (
	"encoding/json"
	"fmt"
	"strings"
)

func ParseExecParamsValue(value string) ([]any, error) {
	var parsed any
	if err := json.Unmarshal([]byte(value), &parsed); err != nil {
		return nil, fmt.Errorf("Exec params must be a valid JSON array: %w", err)
	}

	items, ok := parsed.([]any)
	if !ok {
		return nil, fmt.Errorf("Exec params must be a JSON array.")
	}

	return items, nil
}

func ParseExecToken(token string) any {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return ""
	}

	looksJSONLike := trimmed == "true" || trimmed == "false" || trimmed == "null" ||
		isJSONNumber(trimmed) || strings.HasPrefix(trimmed, "[") ||
		strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "\"")

	if looksJSONLike {
		var parsed any
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			return parsed
		}
	}

	return trimmed
}

func ParseExecTokens(tokens []string) []any {
	parsed := make([]any, 0, len(tokens))
	for _, token := range tokens {
		parsed = append(parsed, ParseExecToken(token))
	}
	return parsed
}

func ParseHostValue(value string, defaultPort int) (HostValue, error) {
	trimmed := strings.TrimSpace(value)
	parts := strings.Split(trimmed, ":")
	if len(parts) == 0 || len(parts) > 2 || strings.TrimSpace(parts[0]) == "" {
		return HostValue{}, fmt.Errorf("Host must be in the form \"<ip>\" or \"<ip>:<port>\".")
	}

	host := strings.TrimSpace(parts[0])
	port := defaultPort
	if len(parts) == 2 {
		if strings.TrimSpace(parts[1]) == "" {
			return HostValue{}, fmt.Errorf("Host port must be an integer between 1 and 65535.")
		}
		parsed := ParseExecToken(parts[1])
		value, ok := parsed.(float64)
		if !ok || value != float64(int(value)) {
			return HostValue{}, fmt.Errorf("Host port must be an integer between 1 and 65535.")
		}
		port = int(value)
	}

	if port < 1 || port > 65535 {
		return HostValue{}, fmt.Errorf("Host port must be an integer between 1 and 65535.")
	}

	return HostValue{Host: host, Port: port}, nil
}

func isJSONNumber(value string) bool {
	var parsed json.Number
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.UseNumber()
	if err := decoder.Decode(&parsed); err != nil {
		return false
	}
	return true
}
