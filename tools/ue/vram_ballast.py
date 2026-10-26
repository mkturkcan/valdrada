#!/usr/bin/env python3
# A resident process that occupies a GPU's video memory so that another process sees only <free> MiB (a real cap: the
# Vulkan driver fails allocations beyond what is left; r.Vulkan.FakeMemoryLimit did not cap Unreal in this build).
#   python3 tools/ue/vram_ballast.py --pci 41 --free 8192 [--ready <file>]
# Allocates 256 MiB blocks until the device reports <free> MiB free, writes the held MiB to --ready, then sleeps
# until it is killed (by PID).
import argparse, os, subprocess, sys, time

ap = argparse.ArgumentParser(); ap.add_argument('--pci', required=True); ap.add_argument('--free', type=int, required=True)
ap.add_argument('--ready', default=None); a = ap.parse_args()
uuid = subprocess.run(['nvidia-smi', f'--id=00000000:{a.pci}:00.0', '--query-gpu=uuid', '--format=csv,noheader'], capture_output=True, text=True).stdout.strip()
os.environ['CUDA_VISIBLE_DEVICES'] = uuid
import torch
torch.cuda.init(); dev = torch.device('cuda:0')
held, MB = [], 1024 * 1024
def free_mib(): return torch.cuda.mem_get_info(0)[0] // MB
while free_mib() > a.free:
    n = min(256, free_mib() - a.free)
    if n <= 0: break
    t = torch.empty(n * MB, dtype=torch.uint8, device=dev); t.fill_(1); held.append(t)
torch.cuda.synchronize()
tot = sum(t.numel() for t in held) // MB
msg = f'held {tot} free {free_mib()} total {torch.cuda.mem_get_info(0)[1] // MB}'
print(msg, flush=True)
if a.ready: open(a.ready + '.tmp', 'w').write(msg + '\n'); os.replace(a.ready + '.tmp', a.ready)
while True: time.sleep(3600)
