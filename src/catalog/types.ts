export type Kind='movie'|'tv';
export type Title={id:number;kind:Kind;title:string;year:string;overview:string;poster:string|null;backdrop:string|null;genres:string[];rating:number|null;votes?:number;runtime:number|null;cast?:string[];director?:string;seasons?:number};
export type Episode={id:number;season:number;number:number;title:string;overview:string;runtime:number|null;still:string|null};
export type Rail={id:string;title:string;items:Title[]};
export type Page={items:Title[];page:number;totalPages:number};
export type Detail=Title & {episodes:Episode[];related:Title[];seasonNumbers:number[];trailers?:{name:string;key:string;site:string}[]};
