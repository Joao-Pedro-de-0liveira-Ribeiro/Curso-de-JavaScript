function compras(trabalho1, trabalho2) {
    const comprarSorvete = trabalho1 || trabalho2 // Operador OU
    const comprarTV50 = trabalho1 && trabalho2 // Operador E
    // const comprarTV32 = !!(trabalho1 ^ trabalho2)    // bitwise do XOR
    const comprarTV32 = trabalho1 != trabalho2
    const manterSaudavel = !comprarSorvete // Operador Unário
    
    return { comprarSorvete, comprarTV50, comprarTV32, manterSaudavel}
}

console.log(compras(true,true))
console.log(compras(true, false))
console.log(compras(false, false))
console.log(compras(false, false))