export function AnimatedCat({ className = "", tone = "blue", variant = "full" }) {
  if (variant === "drop") {
    return (
      <span className={`animated-cat animated-cat-drop animated-cat-${tone} ${className}`} aria-hidden="true">
        <svg viewBox="0 0 160 170" role="img">
          <path className="cat-drop-body" d="M46 32Q80 9 114 32Q132 48 127 84Q122 125 80 129Q38 125 33 84Q28 48 46 32Z" />
          <path className="cat-ear cat-ear-left" d="M45 35L55 16L70 36Z" />
          <path className="cat-ear cat-ear-right" d="M90 36L106 16L116 36Z" />
          <ellipse className="cat-eye cat-eye-left" cx="63" cy="70" rx="15" ry="30" />
          <ellipse className="cat-eye cat-eye-right" cx="96" cy="70" rx="15" ry="30" />
          <path className="cat-eye-shine" d="M56 55Q65 50 69 61Q64 57 56 64Z" />
          <path className="cat-eye-shine" d="M89 55Q98 50 102 61Q97 57 89 64Z" />
          <path className="cat-drop-small" d="M75 139Q81 132 87 139Q92 150 81 156Q70 150 75 139Z" />
          <circle className="cat-drop-dot" cx="82" cy="166" r="3" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`animated-cat animated-cat-full animated-cat-${tone} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 360 230" role="img">
        <ellipse className="cat-shadow" cx="181" cy="198" rx="124" ry="18" />
        <path className="cat-tail" d="M226 137C266 126 312 128 338 137C353 142 351 154 337 157C303 164 259 158 224 151" />
        <path className="cat-body" d="M113 91C149 61 218 66 249 102C274 131 266 170 229 184C186 201 120 190 94 154C78 132 86 108 113 91Z" />
        <path className="cat-head" d="M55 48C78 25 131 26 152 50C174 75 168 123 139 143C108 166 55 155 37 119C23 91 31 63 55 48Z" />
        <path className="cat-ear cat-ear-left" d="M49 54L65 13L94 50Z" />
        <path className="cat-ear cat-ear-right" d="M121 49L151 15L151 70Z" />
        <ellipse className="cat-eye cat-eye-left" cx="75" cy="87" rx="17" ry="34" />
        <ellipse className="cat-eye cat-eye-right" cx="119" cy="86" rx="17" ry="34" />
        <path className="cat-eye-shine" d="M67 66Q78 60 82 74Q75 69 67 78Z" />
        <path className="cat-eye-shine" d="M111 66Q122 60 126 74Q119 69 111 78Z" />
        <path className="cat-leg cat-leg-front" d="M107 154Q92 171 77 162Q66 155 77 144Q88 135 105 142Z" />
        <path className="cat-leg cat-leg-back" d="M178 178Q162 198 141 190Q128 185 136 171Q151 155 178 160Z" />
        <path className="cat-leg cat-leg-back2" d="M222 170Q213 193 193 190Q181 188 185 172Q195 154 221 153Z" />
        <path className="cat-liquid-drop cat-liquid-drop-1" d="M42 161Q51 149 60 161Q65 176 51 183Q37 176 42 161Z" />
        <path className="cat-liquid-drop cat-liquid-drop-2" d="M277 67Q286 56 294 68Q300 82 286 89Q273 82 277 67Z" />
      </svg>
    </span>
  );
}
