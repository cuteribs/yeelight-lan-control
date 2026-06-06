package yeelight

import (
	"bufio"
	"encoding/json"
	"net"
	"strings"
	"testing"
)

func TestSendRawCommandIgnoresPropsAndReturnsMatchingResult(t *testing.T) {
	listener := mustListenTCP(t)
	defer listener.Close()

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		reader := bufio.NewReader(conn)
		line, _ := reader.ReadString('\n')
		var request struct {
			ID uint64 `json:"id"`
		}
		_ = json.Unmarshal([]byte(strings.TrimSpace(line)), &request)

		_, _ = conn.Write([]byte(`{"method":"props","params":{"power":"on"}}` + "\r\n"))
		_, _ = conn.Write([]byte(`{"id":999,"result":["ignored"]}` + "\r\n"))
		payload, _ := json.Marshal(map[string]any{
			"id":     request.ID,
			"result": []any{"ok"},
		})
		_, _ = conn.Write(append(payload, []byte("\r\n")...))
	}()

	client := NewClient(ControlConnectionOptions{Host: "127.0.0.1", Port: tcpPort(t, listener), TimeoutMS: 500})
	response, err := client.SendRawCommand("toggle", []any{}, CommandOptions{})
	if err != nil {
		t.Fatalf("send raw command failed: %v", err)
	}
	if response.Error != nil {
		t.Fatalf("unexpected bulb error: %#v", response.Error)
	}
	items, ok := response.Result.([]any)
	if !ok || len(items) != 1 || items[0] != "ok" {
		t.Fatalf("unexpected result: %#v", response.Result)
	}
}

func TestSendCommandReturnsBulbErrors(t *testing.T) {
	listener := mustListenTCP(t)
	defer listener.Close()

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		line, _ := reader.ReadString('\n')
		var request struct {
			ID uint64 `json:"id"`
		}
		_ = json.Unmarshal([]byte(strings.TrimSpace(line)), &request)
		payload, _ := json.Marshal(map[string]any{
			"id": request.ID,
			"error": map[string]any{
				"code":    -1,
				"message": "unsupported",
			},
		})
		_, _ = conn.Write(append(payload, []byte("\r\n")...))
	}()

	client := NewClient(ControlConnectionOptions{Host: "127.0.0.1", Port: tcpPort(t, listener), TimeoutMS: 500})
	_, err := client.SendCommand("toggle", []any{}, CommandOptions{})
	if err == nil || !strings.Contains(err.Error(), "Yeelight command failed (-1): unsupported") {
		t.Fatalf("expected bulb error, got %v", err)
	}
}

func TestGetStatusMapsGetPropResults(t *testing.T) {
	listener := mustListenTCP(t)
	defer listener.Close()

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		line, _ := reader.ReadString('\n')
		var request struct {
			ID uint64 `json:"id"`
		}
		_ = json.Unmarshal([]byte(strings.TrimSpace(line)), &request)
		payload, _ := json.Marshal(map[string]any{
			"id":     request.ID,
			"result": []any{"on", "50", "3500", "1", "16711680", "0", "100", "Bedroom"},
		})
		_, _ = conn.Write(append(payload, []byte("\r\n")...))
	}()

	client := NewClient(ControlConnectionOptions{Host: "127.0.0.1", Port: tcpPort(t, listener), TimeoutMS: 500})
	status, err := client.GetStatus(CommandOptions{})
	if err != nil {
		t.Fatalf("get status failed: %v", err)
	}
	if status["power"] == nil || *status["power"] != "on" {
		t.Fatalf("unexpected power: %#v", status["power"])
	}
	if status["name"] == nil || *status["name"] != "Bedroom" {
		t.Fatalf("unexpected name: %#v", status["name"])
	}
}

func TestSendCommandRejectsUnsupportedMethodsBeforeDial(t *testing.T) {
	client := NewClient(ControlConnectionOptions{
		Host:      "127.0.0.1",
		Port:      9,
		Support:   []string{"toggle"},
		TimeoutMS: 50,
	})

	_, err := client.SendCommand("set_power", []any{"on", "sudden", 30}, CommandOptions{})
	if err == nil || !strings.Contains(err.Error(), "does not advertise support for set_power") {
		t.Fatalf("expected support check error, got %v", err)
	}
}

func mustListenTCP(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	return listener
}

func tcpPort(t *testing.T, listener net.Listener) int {
	t.Helper()
	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("unexpected listener addr: %T", listener.Addr())
	}
	return addr.Port
}
