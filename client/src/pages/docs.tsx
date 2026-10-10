import { useState } from "react";
import { Link } from "wouter";
import { Terminal, ChevronRight, Copy, Check, ArrowLeft } from "lucide-react";
import schematicImg from "@assets/generated_images/technical_schematic_blueprint.svg";

export default function Docs() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <div className="flex-1 flex pt-16">
        <Sidebar />
        <MainContent />
      </div>
    </div>
  );
}

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 w-full z-50 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="flex items-center justify-between h-16 px-6 w-full">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-primary animate-pulse" />
          <Link href="/">
            <a className="font-display font-bold text-2xl tracking-tighter hover:opacity-80 transition-opacity cursor-pointer">
              NEXUS<span className="text-primary">//</span>INFRA
            </a>
          </Link>
          <span className="ml-4 px-2 py-0.5 border border-border text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Docs v2.4.0
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-sm">
          <Link href="/">
            <a className="flex items-center gap-2 hover:text-primary uppercase tracking-widest text-xs">
              <ArrowLeft className="w-3 h-3" /> Back to Home
            </a>
          </Link>
          <button className="brutal-btn text-xs py-2 px-4">
            API Keys
          </button>
        </div>
      </div>
    </nav>
  );
}

function Sidebar() {
  const sections = [
    {
      title: "Getting Started",
      items: ["Introduction", "Quick Start", "Architecture", "Network Topology"]
    },
    {
      title: "Core Concepts",
      items: ["Nodes & Validators", "RPC Endpoints", "Security Model", "Consensus"]
    },
    {
      title: "API Reference",
      items: ["Authentication", "Rate Limits", "Node Methods", "WebSockets"]
    },
    {
      title: "SDKs",
      items: ["JavaScript / TypeScript", "Python", "Rust", "Go"]
    }
  ];

  return (
    <aside className="w-64 border-r border-border bg-background hidden md:block fixed h-[calc(100vh-4rem)] overflow-y-auto custom-scrollbar">
      <div className="p-6 space-y-8">
        {sections.map((section, i) => (
          <div key={i}>
            <h3 className="font-mono text-xs text-primary uppercase tracking-widest mb-4">{section.title}</h3>
            <ul className="space-y-2">
              {section.items.map((item, j) => (
                <li key={j}>
                  <a href="#" className={`block font-mono text-sm hover:text-primary transition-colors ${i === 0 && j === 0 ? 'text-foreground font-bold' : 'text-muted-foreground'}`}>
                    {i === 0 && j === 0 && <span className="text-primary mr-2">&gt;</span>}
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MainContent() {
  return (
    <main className="flex-1 md:ml-64 p-8 md:p-12 max-w-5xl mx-auto w-full">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground mb-8">
        <span>DOCS</span>
        <ChevronRight className="w-3 h-3" />
        <span>GETTING STARTED</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-primary">INTRODUCTION</span>
      </div>

      <div className="prose prose-invert max-w-none">
        <h1 className="font-display text-5xl md:text-6xl font-bold uppercase tracking-tight mb-6">
          Introduction to <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-white">Nexus Infra</span>
        </h1>
        
        <p className="font-mono text-lg text-muted-foreground leading-relaxed mb-12 border-l-2 border-primary pl-6">
          Nexus Infra provides raw, bare-metal node infrastructure for high-frequency decentralized applications. 
          We bypass the virtualization layer to deliver sub-millisecond latency and 100% predictable performance.
        </p>

        {/* Image Section */}
        <div className="mb-12 border border-border p-1 bg-card">
          <div className="relative aspect-video overflow-hidden bg-black">
             <img src={schematicImg} alt="Architecture Schematic" className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity duration-500" />
             <div className="absolute bottom-4 right-4 bg-black/80 border border-primary px-2 py-1 font-mono text-[10px] text-primary">
               FIG 1.0: NODE TOPOLOGY
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <div className="border border-border p-6 bg-card/50 hover:bg-card transition-colors">
            <Terminal className="w-8 h-8 text-primary mb-4" />
            <h3 className="font-display text-xl font-bold mb-2 uppercase">For Developers</h3>
            <p className="font-mono text-sm text-muted-foreground mb-4">
              Direct RPC access, WebSocket subscriptions, and comprehensive SDKs for all major languages.
            </p>
            <a href="#" className="text-primary text-sm font-mono hover:underline flex items-center gap-1">
              View API Reference <ChevronRight className="w-3 h-3" />
            </a>
          </div>
          <div className="border border-border p-6 bg-card/50 hover:bg-card transition-colors">
            <div className="w-8 h-8 text-primary mb-4 flex items-center justify-center border border-primary rounded-full text-xs font-bold">
              !
            </div>
            <h3 className="font-display text-xl font-bold mb-2 uppercase">For Validators</h3>
            <p className="font-mono text-sm text-muted-foreground mb-4">
              Institutional-grade staking infrastructure with 99.999% uptime SLAs and slashing insurance.
            </p>
            <a href="#" className="text-primary text-sm font-mono hover:underline flex items-center gap-1">
              Validator Guide <ChevronRight className="w-3 h-3" />
            </a>
          </div>
        </div>

        <h2 className="font-display text-3xl font-bold uppercase mb-6 pt-8 border-t border-border">Quick Start</h2>
        <p className="font-mono text-muted-foreground mb-6">
          Install the Nexus CLI to deploy your first node instance in seconds.
        </p>

        <CodeBlock 
          language="bash" 
          code={`# Install via npm
npm install -g @nexus-infra/cli

# Authenticate with your API key
nexus auth login --key=nx_live_89234...

# Deploy a standard Ethereum node
nexus deploy --chain=eth --network=mainnet --type=archive

# Stop a running node
nexus stop --chain=eth --network=mainnet`} 
        />

        <h2 className="font-display text-3xl font-bold uppercase mb-6 pt-8">Configuration</h2>
        <p className="font-mono text-muted-foreground mb-6">
          Configure your node settings via <code className="bg-border px-1 py-0.5 text-primary">nexus.config.js</code> in your project root.
        </p>

        <CodeBlock 
          language="javascript" 
          code={`module.exports = {
  project: "defi-aggregator-v1",
  region: "us-east-1",
  nodes: {
    eth: {
      type: "full",
      sync: "fast",
      pruning: false
    },
    sol: {
      rpc: true,
      ws: true
    }
  },
  security: {
    firewall: true,
    rateLimit: 10000 // req/min
  }
}`} 
        />

      </div>
    </main>
  );
}

function CodeBlock({ code, language }: { code: string, language: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-6 border border-border bg-[#050505] relative group">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/20">
        <span className="font-mono text-xs text-muted-foreground uppercase">{language}</span>
        <button 
          onClick={copyToClipboard}
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre className="font-mono text-sm text-foreground">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
