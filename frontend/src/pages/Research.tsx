import { Link } from 'react-router-dom'
import PipelineDiagram from '../components/PipelineDiagram'
import Reveal from '../components/Reveal'

const metrics = [
  ['WER (ASR accuracy)', '11%', 'Word error rate vs. human reference — lower is better.'],
  ['BLEU (translation)', '38.7', 'n-gram overlap against reference translations.'],
  ['COMET (translation)', '0.86', 'Learned, reference-based quality — correlates with human judgment.'],
  ['MOS (naturalness)', '3.5 / 5', 'Mean opinion score from human raters.'],
  ['Speaker similarity', '87.3%', 'Cosine similarity of source vs. synthesized speaker embeddings.'],
  ['Sync offset', '41 ms', 'Mean A/V offset — within the 125 ms ITU-R BT.1359-1 threshold.'],
]

const stages = [
  ['ASR · Speech-to-Text', 'Whisper medium', 'Transcribes source audio with word-level timestamps that are retained throughout to constrain later stages to compatible durations.'],
  ['NMT · Translation', 'NLLB-200 (distilled-600M)', 'A Transformer model translates sentence-by-sentence, with candidates scored for length compatibility so the dub fits the original time budget.'],
  ['TTS + Voice Cloning', 'OmniVoice', 'A speaker embedding from the source conditions synthesis, so output keeps the source timbre and identity — the pipeline’s key innovation.'],
  ['Synchronization', 'ffmpeg', 'Synthesized audio is time-stretched to the segment boundaries and muxed with the source video to produce the final dubbed output.'],
]

const refs = [
  'Radford et al. (2023). Robust speech recognition via large-scale weak supervision. ICML.',
  'Vaswani et al. (2017). Attention is all you need. NeurIPS 30.',
  'Wang et al. (2017). Tacotron: Towards end-to-end speech synthesis. arXiv:1703.10135.',
  'Jia et al. (2018). Transfer learning from speaker verification to multispeaker TTS. NeurIPS 31.',
  'Jia et al. (2022). Translatotron 2: High-quality direct S2S translation with voice preservation. ICML.',
  'Papineni et al. (2002). BLEU: a method for automatic evaluation of MT. ACL.',
  'Rei et al. (2020). COMET: A neural framework for MT evaluation. EMNLP.',
  'ITU-R (2019). Recommendation BT.1359-1: Relative timing of sound and vision for broadcasting.',
]

export default function Research() {
  return (
    <div className="mx-auto max-w-5xl px-5 pt-14 pb-8">
      <Reveal>
        <span className="chip inline-flex items-center gap-2 px-3 py-1.5 text-xs text-white/70">
          RSEF 2026 · Preprint
        </span>
        <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          An automatic AI dubbing system for multilingual video with{' '}
          <span className="gradient-text">voice preservation</span>
        </h1>
        <p className="mt-4 text-white/55">
          Isoqov Jo’rabek · Asilbek Abdug’afforov — New Uzbekistan University
        </p>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="card mt-8 p-6 sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-300/80">Abstract</h2>
          <p className="mt-3 leading-relaxed text-white/70">
            Manual video dubbing is slow, costly, and strips away a speaker’s
            original vocal identity. This work presents a cascaded ASR → NMT →
            TTS-with-voice-cloning pipeline that translates spoken dialogue in a
            source video into a target language while preserving the original
            speaker’s voice identity and the timing of the source performance. On
            our evaluation set the pipeline reaches 11% WER, 38.7 BLEU (0.86
            COMET), a 3.5/5 MOS, 87.3% speaker similarity, and a 41 ms sync offset —
            within the ITU-R BT.1359-1 detectability threshold for lip-sync error.
          </p>
        </div>
      </Reveal>

      {/* Architecture */}
      <section className="mt-12">
        <Reveal>
          <h2 className="text-2xl font-bold tracking-tight">System architecture</h2>
          <p className="mt-2 text-white/55">Four stages, chained from openly-available pretrained components.</p>
        </Reveal>
        <div className="mt-6">
          <PipelineDiagram />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {stages.map(([title, engine, desc], i) => (
            <Reveal key={title} delay={i * 0.05}>
              <div className="card h-full p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">{title}</h3>
                  <span className="font-mono text-[10px] text-cyan-300/80">{engine}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Metrics */}
      <section className="mt-12">
        <Reveal>
          <h2 className="text-2xl font-bold tracking-tight">Evaluation results</h2>
          <p className="mt-2 text-white/55">Five-metric framework spanning transcription, translation, naturalness, identity and sync.</p>
        </Reveal>
        <div className="card mt-6 divide-y divide-white/5 overflow-hidden">
          {metrics.map(([name, val, desc], i) => (
            <Reveal key={name} delay={i * 0.04}>
              <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[220px_100px_1fr]">
                <div className="text-sm font-medium text-white">{name}</div>
                <div className="text-right text-lg font-bold text-white sm:text-left">
                  <span className="gradient-text">{val}</span>
                </div>
                <div className="col-span-2 text-xs text-white/50 sm:col-span-1">{desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Discussion / ethics */}
      <section className="mt-12 grid gap-4 md:grid-cols-2">
        <Reveal>
          <div className="card h-full p-6">
            <h3 className="text-lg font-semibold text-white">Where it stands</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              The results describe a pipeline that is usably accurate but not yet
              uniformly strong. Translation (COMET 0.86), speaker preservation
              (87.3%) and sync (41 ms) are solid; naturalness (MOS 3.5) is the
              clearest remaining gap — a common limitation of current TTS. Because
              stages are cascaded, ASR errors can also propagate downstream.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="card h-full border-amber-400/20 bg-amber-400/[0.03] p-6">
            <h3 className="text-lg font-semibold text-white">Ethical use</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              Voice cloning raises real concerns around consent and misuse. This
              system is intended to re-voice a speaker’s own translated words for
              their own source video. Any third-party use should include explicit
              speaker consent and clear labeling of AI-dubbed content.
            </p>
          </div>
        </Reveal>
      </section>

      {/* References */}
      <section className="mt-12">
        <Reveal>
          <h2 className="text-2xl font-bold tracking-tight">References</h2>
        </Reveal>
        <ol className="mt-5 space-y-2.5">
          {refs.map((r, i) => (
            <li key={i} className="flex gap-3 text-sm text-white/50">
              <span className="font-mono text-xs text-violet-300/70">[{i + 1}]</span>
              <span>{r}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-14 text-center">
        <Link to="/studio" className="btn-primary px-7 py-3.5 text-sm">
          See the pipeline in action →
        </Link>
      </div>
    </div>
  )
}
