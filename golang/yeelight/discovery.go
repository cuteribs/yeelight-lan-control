package yeelight

import (
	"fmt"
	"net"
	"time"
)

func ListDiscoveryInterfaces() ([]string, error) {
	interfaces, err := activeInterfaceAddresses()
	if err != nil {
		return nil, err
	}
	results := make([]string, 0, len(interfaces))
	for _, address := range interfaces {
		results = append(results, address.String())
	}
	return results, nil
}

func DiscoverDevices(options DiscoveryOptions) ([]DiscoveredDevice, error) {
	timeoutMS := options.TimeoutMS
	if timeoutMS <= 0 {
		timeoutMS = DefaultDiscoveryTimeout
	}

	addresses, err := activeInterfaceAddresses()
	if err != nil {
		return nil, err
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("Yeelight discovery failed: no active IPv4 network interfaces were found.")
	}

	request := BuildDiscoveryRequest()
	destination := &net.UDPAddr{IP: net.ParseIP(DiscoveryAddress), Port: DiscoveryPort}
	listeners := make([]*net.UDPConn, 0, len(addresses))
	defer func() {
		for _, listener := range listeners {
			_ = listener.Close()
		}
	}()

	for _, address := range addresses {
		listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: address, Port: 0})
		if err != nil {
			continue
		}
		listeners = append(listeners, listener)
	}
	if len(listeners) == 0 {
		return nil, fmt.Errorf("Yeelight discovery failed: unable to bind UDP sockets on active IPv4 interfaces.")
	}

	if err := sendSearch(listeners, request, destination); err != nil {
		return nil, err
	}

	startedAt := time.Now()
	deadline := startedAt.Add(time.Duration(timeoutMS) * time.Millisecond)
	resendAt := startedAt.Add(time.Duration(minInt(timeoutMS, 1000)) * time.Millisecond)
	resent := false
	devices := map[string]DiscoveredDevice{}

	for time.Now().Before(deadline) {
		if !resent && time.Now().After(resendAt) {
			if err := sendSearch(listeners, request, destination); err != nil {
				return nil, err
			}
			resent = true
		}

		hadActivity := false
		for _, listener := range listeners {
			_ = listener.SetReadDeadline(time.Now().Add(75 * time.Millisecond))
			for {
				buffer := make([]byte, 2048)
				size, _, err := listener.ReadFromUDP(buffer)
				if err != nil {
					netErr, ok := err.(net.Error)
					if ok && netErr.Timeout() {
						break
					}
					return nil, fmt.Errorf("Yeelight discovery failed while reading sockets: %w", err)
				}
				hadActivity = true
				if device := ParseDiscoveryResponse(buffer[:size]); device != nil {
					devices[device.ID] = *device
				}
			}
		}

		if !hadActivity {
			time.Sleep(5 * time.Millisecond)
		}
	}

	results := make([]DiscoveredDevice, 0, len(devices))
	for _, device := range devices {
		results = append(results, device)
	}
	return results, nil
}

func activeInterfaceAddresses() ([]net.IP, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}

	results := []net.IP{}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			netAddr, ok := address.(*net.IPNet)
			if !ok || netAddr.IP == nil {
				continue
			}
			ip := netAddr.IP.To4()
			if ip == nil || ip.IsLoopback() {
				continue
			}
			results = append(results, ip)
		}
	}
	return results, nil
}

func sendSearch(listeners []*net.UDPConn, request []byte, destination *net.UDPAddr) error {
	for _, listener := range listeners {
		if _, err := listener.WriteToUDP(request, destination); err != nil {
			return fmt.Errorf("Yeelight discovery send failed: %w", err)
		}
	}
	return nil
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
