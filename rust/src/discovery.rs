use std::collections::BTreeMap;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

use if_addrs::{IfAddr, get_if_addrs};
use socket2::{Domain, Protocol, Socket, Type};

use crate::error::{Result, YeelightError};
use crate::protocol::{
    DEFAULT_DISCOVERY_TIMEOUT_MS, DISCOVERY_ADDRESS, DISCOVERY_PORT, build_discovery_request,
    parse_discovery_response,
};
use crate::types::{YeelightDiscoveredDevice, YeelightDiscoveryOptions};

pub fn list_discovery_interfaces() -> Result<Vec<String>> {
    Ok(get_if_addrs()?
        .into_iter()
        .filter_map(|interface| match interface.addr {
            IfAddr::V4(v4) if !interface.is_loopback() => Some(v4.ip.to_string()),
            _ => None,
        })
        .collect())
}

pub fn discover_devices(options: YeelightDiscoveryOptions) -> Result<Vec<YeelightDiscoveredDevice>> {
    let timeout_ms = options.timeout_ms.unwrap_or(DEFAULT_DISCOVERY_TIMEOUT_MS);
    let addresses: Vec<Ipv4Addr> = get_if_addrs()?
        .into_iter()
        .filter_map(|interface| match interface.addr {
            IfAddr::V4(v4) if !interface.is_loopback() => Some(v4.ip),
            _ => None,
        })
        .collect();

    if addresses.is_empty() {
        return Err(YeelightError::from(
            "Yeelight discovery failed: no active IPv4 network interfaces were found.",
        ));
    }

    let destination = SocketAddrV4::new(
        DISCOVERY_ADDRESS
            .parse::<Ipv4Addr>()
            .map_err(|error| YeelightError::from(format!("Invalid discovery address: {error}")))?,
        DISCOVERY_PORT,
    );
    let request = build_discovery_request();

    let mut sockets = Vec::with_capacity(addresses.len());
    for address in addresses {
        sockets.push(setup_socket(address)?);
    }

    send_search(&sockets, &request, destination)?;
    let started_at = Instant::now();
    let deadline = started_at + Duration::from_millis(timeout_ms);
    let resend_at = started_at + Duration::from_millis(timeout_ms.min(1000));
    let mut resent = false;
    let mut devices = BTreeMap::new();

    while Instant::now() < deadline {
        if !resent && Instant::now() >= resend_at {
            send_search(&sockets, &request, destination)?;
            resent = true;
        }

        let mut had_activity = false;
        for socket in &sockets {
            loop {
                let mut buffer = [0_u8; 2048];
                match socket.recv_from(&mut buffer) {
                    Ok((size, _)) => {
                        had_activity = true;
                        if let Some(device) = parse_discovery_response(&buffer[..size]) {
                            devices.insert(device.id.clone(), device);
                        }
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        break;
                    }
                    Err(error) => {
                        return Err(YeelightError::from(format!(
                            "Yeelight discovery failed while reading sockets: {error}"
                        )));
                    }
                }
            }
        }

        if !had_activity {
            std::thread::yield_now();
        }
    }

    Ok(devices.into_values().collect())
}

fn setup_socket(interface: Ipv4Addr) -> Result<UdpSocket> {
    let multicast = DISCOVERY_ADDRESS
        .parse::<Ipv4Addr>()
        .map_err(|error| YeelightError::from(format!("Invalid discovery address: {error}")))?;
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_address(true)?;
    #[cfg(unix)]
    let _ = socket.set_reuse_port(true);

    if socket
        .bind(&SocketAddrV4::new(interface, DISCOVERY_PORT).into())
        .is_err()
    {
        socket.bind(&SocketAddrV4::new(interface, 0).into())?;
    }

    socket.join_multicast_v4(&multicast, &interface)?;
    socket.set_multicast_ttl_v4(12)?;
    let udp_socket: UdpSocket = socket.into();
    udp_socket.set_read_timeout(Some(Duration::from_millis(75)))?;
    Ok(udp_socket)
}

fn send_search(sockets: &[UdpSocket], request: &[u8], destination: SocketAddrV4) -> Result<()> {
    for socket in sockets {
        socket.send_to(request, destination)?;
    }
    Ok(())
}
