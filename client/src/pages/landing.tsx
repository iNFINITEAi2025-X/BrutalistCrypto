import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Terminal, Cpu, Shield, Zap, Globe, Lock } from "lucide-react";

// Assets
import wireframeImg from "@assets/generated_images/wireframe_brutalist_structure.svg";
import noiseTexture from "@assets/generated_images/gritty_noise_texture.svg";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-black overflow-x-hidden">
      <Navbar />
      <Hero />
      <Marquee />
      <GridSection />
      <TerminalSection />
      <Footer />
    </div>
  );
}

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 w-full z-50 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="flex items-center justify-between h-16 px-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-primary animate-pulse" />
          <span className="font-display font-bold text-2xl tracking-tighter">NEXUS<span className="text-primary">//</span>INFRA</span>
        </div>
        <div className="hidden md:flex items-center gap-8 font-mono text-sm">
          <a href="#" className="hover:text-primary uppercase tracking-widest">Nodes</a>
          <a href="#" className="hover:text-primary uppercase tracking-widest">RPC</a>
          <Link href="/docs">
            <a className="hover:text-primary uppercase tracking-widest cursor-pointer">Docs</a>
          </Link>
          <button className="brutal-btn text-xs">
            Connect_Wallet
          </button>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const [deployed, setDeployed] = useState(false);
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-16 border-b border-border overflow-hidden">
      {/* Background Layers */}
      <div className="absolute inset-0 z-0 opacity-30">
        <img src={wireframeImg} alt="Background" className="w-full h-full object-cover" />
      </div>
      <div className="absolute inset-0 z-0 mix-blend-overlay opacity-20 pointer-events-none" 
           style={{ backgroundImage: `url(${noiseTexture})` }}></div>
      
      <div className="relative z-10 max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-12 gap-12">
        <div className="md:col-span-8 space-y-8">
          <div className="inline-block border border-primary px-3 py-1 font-mono text-xs text-primary tracking-widest uppercase mb-4 bg-primary/10">
            System Status: Online
          </div>
          <h1 className="font-display text-6xl md:text-8xl font-bold leading-[0.85] tracking-tighter uppercase">
            Decentralized <br />
            <span className="text-stroke-primary">Infrastructure</span> <br />
            For The <span className="bg-primary text-black px-2">Future</span>
          </h1>
          <p className="font-mono text-muted-foreground text-lg max-w-2xl border-l-2 border-primary pl-6">
            High-performance node infrastructure for the next generation of dApps. 
            Zero latency. 100% uptime. Raw computational power.
          </p>
          
          <div className="flex flex-col md:flex-row gap-4 pt-8">
            <button
              className="brutal-btn flex items-center gap-2 group"
              onClick={() => setDeployed((d) => !d)}
              data-testid="button-deploy-toggle"
            >
              {deployed ? "Stop Node" : "Deploy Node"} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
            <Link href="/docs">
              <button className="px-6 py-3 font-mono uppercase tracking-wider border border-border hover:bg-border transition-colors">
                Read Documentation
              </button>
            </Link>
          </div>
        </div>

        <div className="md:col-span-4 flex flex-col justify-end border-l border-border pl-8 hidden md:flex">
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">LATENCY</span>
              <span className="text-primary">12ms</span>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">UPTIME</span>
              <span className="text-primary">99.99%</span>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">NODES</span>
              <span className="text-primary">8,420</span>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">REGION</span>
              <span className="text-primary">GLOBAL</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  return (
    <div className="border-b border-border bg-primary py-3 overflow-hidden whitespace-nowrap">
      <motion.div 
        className="flex gap-8 font-display font-bold text-2xl text-black uppercase tracking-widest"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ repeat: Infinity, duration: 15, ease: "linear" }}
      >
        {[...Array(10)].map((_, i) => (
          <span key={i} className="flex items-center gap-8">
            Raw Power // Zero Latency // Decentralized // Nexus Infra //
          </span>
        ))}
      </motion.div>
    </div>
  );
}

function GridSection() {
  const features = [
    { icon: Zap, title: "Lightning RPC", desc: "Sub-millisecond response times for high-frequency trading applications." },
    { icon: Shield, title: "Military Grade", desc: "End-to-end encryption and DDoS protection built into the core." },
    { icon: Cpu, title: "Bare Metal", desc: "Direct hardware access. No virtualization overhead. Pure performance." },
    { icon: Globe, title: "Global Mesh", desc: "Distributed network across 40+ regions for localized latency optimization." },
    { icon: Lock, title: "Trustless", desc: "Verifiable computation proofs ensuring data integrity." },
    { icon: Terminal, title: "API First", desc: "Developer-centric SDKs and CLI tools for seamless integration." },
  ];

  return (
    <section className="py-24 max-w-7xl mx-auto px-6">
      <div className="mb-16">
        <h2 className="font-display text-5xl font-bold uppercase mb-4">Core Specs</h2>
        <div className="h-1 w-32 bg-primary"></div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
        {features.map((f, i) => (
          <div key={i} className="bg-background p-8 hover:bg-card transition-colors group relative overflow-hidden h-full">
            <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-100 transition-opacity">
              <f.icon className="w-12 h-12 text-primary" />
            </div>
            <div className="relative z-10">
              <div className="font-mono text-xs text-primary mb-4">0{i + 1} // SPEC</div>
              <h3 className="font-display text-2xl mb-3">{f.title}</h3>
              <p className="font-mono text-muted-foreground text-sm leading-relaxed">
                {f.desc}
              </p>
            </div>
            <div className="absolute bottom-0 left-0 h-1 w-0 bg-primary group-hover:w-full transition-all duration-300" />
          </div>
        ))}
      </div>
    </section>
  );
}

function TerminalSection() {
  const [lines, setLines] = useState<string[]>([]);
  
  useEffect(() => {
    const logs = [
      "> Initializing NEXUS protocol...",
      "> Connecting to mesh network...",
      "> Node [US-EAST-1] verified.",
      "> Node [EU-CENTRAL] verified.",
      "> Node [ASIA-SOUTH] verified.",
      "> Syncing ledger state... 100%",
      "> Optimizing routes for lowest latency...",
      "> SYSTEM READY. AWAITING INPUT."
    ];
    
    let i = 0;
    const interval = setInterval(() => {
      if (i < logs.length) {
        setLines(prev => [...prev, logs[i]]);
        i++;
      } else {
        clearInterval(interval);
      }
    }, 800);
    
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="border-y border-border bg-black py-24">
      <div className="max-w-5xl mx-auto px-6">
        <div className="border border-border bg-card p-1 relative">
          <div className="absolute top-0 left-0 w-full h-6 bg-border flex items-center px-2 gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full opacity-50"></div>
            <div className="w-3 h-3 bg-yellow-500 rounded-full opacity-50"></div>
            <div className="w-3 h-3 bg-green-500 rounded-full opacity-50"></div>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">bash -- nexus-cli</span>
          </div>
          <div className="pt-8 pb-4 px-6 font-mono text-sm md:text-base h-64 overflow-y-auto">
            {lines.map((line, i) => (
              <div key={i} className="mb-1">
                <span className="text-muted-foreground mr-2">{new Date().toLocaleTimeString()}</span>
                <span className="text-primary">{line}</span>
              </div>
            ))}
            <div className="animate-pulse text-primary">_</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-12 border-t border-border bg-background">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
        <div className="col-span-1 md:col-span-2">
          <h2 className="font-display text-4xl font-bold mb-6">NEXUS<span className="text-primary">INFRA</span></h2>
          <p className="font-mono text-muted-foreground max-w-sm">
            Building the backbone of the decentralized web. Uncompromising performance for uncompromising applications.
          </p>
        </div>
        
        <div>
          <h4 className="font-mono text-primary mb-4 uppercase">Platform</h4>
          <ul className="space-y-2 font-mono text-sm text-muted-foreground">
            <li><a href="#" className="hover:text-foreground">Nodes</a></li>
            <li><a href="#" className="hover:text-foreground">Analytics</a></li>
            <li><a href="#" className="hover:text-foreground">API</a></li>
            <li><a href="#" className="hover:text-foreground">Status</a></li>
          </ul>
        </div>
        
        <div>
          <h4 className="font-mono text-primary mb-4 uppercase">Company</h4>
          <ul className="space-y-2 font-mono text-sm text-muted-foreground">
            <li><a href="#" className="hover:text-foreground">About</a></li>
            <li><a href="#" className="hover:text-foreground">Careers</a></li>
            <li><a href="#" className="hover:text-foreground">Blog</a></li>
            <li><a href="#" className="hover:text-foreground">Legal</a></li>
          </ul>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center font-mono text-xs text-muted-foreground">
        <div>© 2025 NEXUS INFRASTRUCTURE INC.</div>
        <div className="mt-2 md:mt-0">DESIGNED IN BUSHWICK</div>
      </div>
    </footer>
  );
}
