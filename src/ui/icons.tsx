import React from 'react';
import Svg, {Path,Rect,Circle,Line} from 'react-native-svg';
export type IconName='play'|'pause'|'plus'|'check'|'back'|'search'|'list'|'rewind'|'forward'|'audio'|'subtitles'|'settings'|'next'|'close';
export function Icon({name,size=22,color='#F5F4F0'}:{name:IconName;size?:number;color?:string}){
 const common={stroke:color,strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,fill:'none'};
 const shapes:Record<IconName,React.ReactNode>={
 play:<Path d="M7 4L20 12L7 20Z" {...common}/>,pause:<Path d="M7 5V19M17 5V19" {...common} strokeWidth={3.5}/>,
 plus:<Path d="M12 4V20M4 12H20" {...common}/>,check:<Path d="M4 12L9 17L20 6" {...common}/>,back:<Path d="M15 5L8 12L15 19" {...common}/>,
 search:<Path d="M17 10.5A6.5 6.5 0 1 1 4 10.5A6.5 6.5 0 1 1 17 10.5M15.5 15.5L21 21" {...common}/>,list:<><Path d="M8 6H21M8 12H21M8 18H21" {...common}/><Circle cx="3" cy="6" r="1" fill={color}/><Circle cx="3" cy="12" r="1" fill={color}/><Circle cx="3" cy="18" r="1" fill={color}/></>,
 rewind:<Path d="M11 5L3 12L11 19ZM21 5L13 12L21 19Z" {...common}/>,forward:<Path d="M3 5L11 12L3 19ZM13 5L21 12L13 19Z" {...common}/>,
 audio:<><Path d="M4 9H8L13 5V19L8 15H4ZM17 8Q23 12 17 16" {...common}/></>,subtitles:<><Path d="M3 4H21V20H3Z" {...common}/><Path d="M5 11H10M14 11H19M5 15H13M16 15H19" {...common}/></>,
 settings:<><Path d="M12 3L15 4L16 7L20 8L21 12L19 15L19 19L15 20L12 22L9 20L5 19L5 15L3 12L4 8L8 7L9 4Z" {...common}/><Circle cx="12" cy="12" r="3" {...common}/></>,
 next:<><Path d="M5 4L17 12L5 20Z" {...common}/><Line x1="20" y1="4" x2="20" y2="20" {...common}/></>,close:<Path d="M5 5L19 19M19 5L5 19" {...common}/>,
 };return <Svg width={size} height={size} viewBox="0 0 24 24">{shapes[name]}</Svg>;
}
