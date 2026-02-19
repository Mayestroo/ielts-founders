#!/bin/bash
# Network stack tuning for 300Mbit/s port and high concurrency
# Run with sudo

echo "🚀 Applying kernel optimizations..."

# Increase max open files
sysctl -w fs.file-max=200000

# Increase connection queue size
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
sysctl -w net.core.netdev_max_backlog=5000

# Optimize TCP connection handling
sysctl -w net.ipv4.tcp_fin_timeout=15
sysctl -w net.ipv4.tcp_tw_reuse=1
sysctl -w net.ipv4.tcp_keepalive_time=300
sysctl -w net.ipv4.ip_local_port_range="1024 65000"

# Apply changes
sysctl -p

echo "✅ Host network tuning applied successfully."
