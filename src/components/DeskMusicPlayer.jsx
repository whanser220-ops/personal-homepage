"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, SlidersHorizontal, Music2, X } from "lucide-react";
import { createAfternoonAudio } from "../lib/home-scene/createAfternoonAudio.js";
import styles from "./DeskMusicPlayer.module.css";

export function DeskMusicPlayer({ position }) {
  const engine = useRef(null), audio = useRef(null), fileUrl = useRef(null);
  const alive = useRef(true), busy = useRef(false), input = useRef(null);
  const [playing, setPlaying] = useState(false), [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(.4), [track, setTrack] = useState("午后慢调");
  const [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    function hide() {
      if (!document.hidden) return;
      audio.current?.pause();
      void engine.current?.pause();
      setPlaying(false);
    }
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", hide);
      engine.current?.dispose(); engine.current = null;
      audio.current?.pause();
      if (audio.current) { audio.current.removeAttribute("src"); audio.current.load(); audio.current = null; }
      if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    };
  }, []);
  async function toggle() {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      if (playing) { audio.current?.pause(); await engine.current?.pause(); }
      else if (audio.current) await audio.current.play();
      else {
        engine.current ||= createAfternoonAudio();
        engine.current.volume(volume);
        await engine.current.play();
      }
      if (alive.current && !document.hidden) setPlaying(!playing);
      else { audio.current?.pause(); await engine.current?.pause(); }
    } catch { if (alive.current) { setError("暂时无法播放，请重试或换一首音乐。"); setPlaying(false); setOpen(true); } }
    finally { busy.current = false; }
  }
  function changeVolume(value) {
    setVolume(value); engine.current?.volume(value);
    if (audio.current) audio.current.volume = value;
  }
  async function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    audio.current?.pause();
    await engine.current?.pause();
    if (!alive.current) return;
    if (fileUrl.current) URL.revokeObjectURL(fileUrl.current);
    fileUrl.current = URL.createObjectURL(file);
    const media = new Audio(fileUrl.current);
    media.loop = true; media.volume = volume;
    media.onerror = () => { if (alive.current) { setError("无法读取这首音乐，请选择 MP3、WAV 或 OGG。"); setPlaying(false); } };
    audio.current = media;
    setTrack(file.name.replace(/\.[^.]+$/, "")); setPlaying(false); setError("");
    event.target.value = "";
  }
  return (
    <div className={styles.player} style={{ left: position.x, top: position.y, width: position.width }} data-playing={playing}>
      <button className={styles.play} onClick={toggle} aria-label={playing ? "暂停桌面音乐" : "播放桌面音乐"} aria-pressed={playing} title={playing ? "暂停音乐" : `播放 · ${track}`}>
        <span className={styles.screen} aria-hidden="true"><span>{playing ? "NOW PLAYING" : "AFTERNOON"}</span><span className={styles.bars}>{[1,2,3,4,5].map(i=><i key={i}/>)}</span></span>
        <span className={styles.playIcon}>{playing ? <Pause size={11} fill="currentColor"/> : <Play size={11} fill="currentColor"/>}</span>
      </button>
      <button className={styles.settings} aria-label="音乐设置" aria-expanded={open} aria-controls="desk-music-settings" onClick={()=>setOpen(!open)}><SlidersHorizontal size={13}/></button>
      {open && <section id="desk-music-settings" className={styles.panel} aria-label="桌面音乐设置" onKeyDown={e=>{if(e.key==="Escape")setOpen(false);}}>
        <div className={styles.heading}><Music2 size={15}/><strong title={track}>{track}</strong><button aria-label="关闭音乐设置" onClick={()=>setOpen(false)}><X size={14}/></button></div>
        <label>音量 <input aria-label="音乐音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={e=>changeVolume(Number(e.target.value))}/></label>
        <button className={styles.file} onClick={()=>input.current?.click()}>选择本地音乐 <span>仅在此设备播放</span></button>
        {error && <p role="status">{error}</p>}
      </section>}
      <input ref={input} type="file" accept="audio/*" hidden aria-label="选择本地音乐文件" onChange={chooseFile}/>
    </div>
  );
}
