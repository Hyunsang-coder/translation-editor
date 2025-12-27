import { useMemo } from 'react';

export function SkeletonLine(props: {
  className?: string;
  widthClassName?: string;
  heightClassName?: string;
}): JSX.Element {
  const { className, widthClassName, heightClassName } = props;
  return (
    <div
      aria-hidden="true"
      className={[
        'rounded bg-gray-200 dark:bg-gray-700',
        heightClassName ?? 'h-3',
        widthClassName ?? 'w-full',
        className ?? '',
      ].join(' ')}
    />
  );
}

export function SkeletonParagraph(props: {
  /**
   * 반복되는 패턴이 너무 고정적으로 보이지 않게, seed에 따라 폭 프리셋을 선택합니다.
   * (랜덤 사용 X: 재현 가능하게)
   */
  seed?: number;
  lines?: number;
  className?: string;
}): JSX.Element {
  const seed = props.seed ?? 0;
  const lines = Math.max(1, Math.min(16, props.lines ?? 8));

  const widths = useMemo(() => {
    const presets: string[][] = [
      ['w-11/12', 'w-10/12', 'w-9/12', 'w-8/12', 'w-10/12', 'w-7/12', 'w-9/12', 'w-6/12'],
      ['w-10/12', 'w-8/12', 'w-11/12', 'w-9/12', 'w-7/12', 'w-10/12', 'w-8/12', 'w-6/12'],
      ['w-9/12', 'w-11/12', 'w-8/12', 'w-10/12', 'w-6/12', 'w-9/12', 'w-10/12', 'w-7/12'],
    ];
    const preset = presets[Math.abs(seed) % presets.length] ?? presets[0]!;
    const out: string[] = [];
    for (let i = 0; i < lines; i += 1) {
      out.push(preset[i % preset.length]!);
    }
    return out;
  }, [seed, lines]);

  return (
    <div className={['animate-pulse space-y-2', props.className ?? ''].join(' ')}>
      {widths.map((w, idx) => (
        <SkeletonLine key={`${seed}-${idx}`} widthClassName={w} />
      ))}
    </div>
  );
}


