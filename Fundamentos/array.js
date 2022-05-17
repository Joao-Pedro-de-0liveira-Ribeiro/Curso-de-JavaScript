const valores = [7.7, 8.9, 6.3, 9.2]
console.log(valores[0],valores[3])
console.log(valores[4])

valores[4] = 10
console.log(valores)
console.log(valores.length) // Quantos elementos tem no Array

valores.push({id: 3}, false, null, 'teste')  // Adiciona novos elementos
console.log(valores)

console.log(valores.pop()) // Retirar elementos do Array
delete valores[3] // Retirar elementos do Array
console.log(valores)

console.log(typeof valores) // Tipos Object